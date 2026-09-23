/* ROGER Mini-Sentinel CDM v3.0 engine 1.0. SAS 9.4.
   Identifier types are checked across every required input before scanning.
   Annual extracts remain separate to preserve each source file's attributes. */

%macro rg_checkpoint(label);
  %if &syserr > 4 or &syscc > 4 %then %do;
    %put ERROR: ROGER stopped after &label.. Review the SAS log.;
    %abort cancel;
  %end;
%mend;

%macro rg_require(ds, vars, types, extract);
  %local handle j variable position expected observed rc width;
  %let handle=%sysfunc(open(&ds,i));
  %if &handle=0 %then %do;
    %put ERROR: Cannot open &ds.. Check the CDM delivery years and input library.;
    %abort cancel;
  %end;
  %do j=1 %to %sysfunc(countw(&vars));
    %let variable=%scan(&vars,&j);
    %let expected=%scan(&types,&j);
    %let position=%sysfunc(varnum(&handle,&variable));
    %if &position=0 %then %do;
      %let rc=%sysfunc(close(&handle));
      %put ERROR: Missing CDM field &variable in &ds.. Verify the supplied rollup and dictionary.;
      %abort cancel;
    %end;
    %let observed=%sysfunc(vartype(&handle,&position));
    %if &expected ne A and &observed ne &expected %then %do;
      %let rc=%sysfunc(close(&handle));
      %put ERROR: Unexpected type for &variable in &ds..;
      %abort cancel;
    %end;
    %let width=%sysfunc(varlen(&handle,&position));
    %if %upcase(&variable)=PATID %then %do;
      %if %length(%superq(patid_type))=0 %then %let patid_type=&observed;
      %else %if &patid_type ne &observed %then %do;
        %let rc=%sysfunc(close(&handle));
        %put ERROR: PatID type differs across CDM tables at &ds..;
        %abort cancel;
      %end;
      %if &observed=C %then %let patid_length=%sysfunc(max(&patid_length,&width));
    %end;
    %if %upcase(&variable)=ENCOUNTERID %then %let encounterid_length=%sysfunc(max(&encounterid_length,&width));
  %end;
  %if &extract=1 and %sysfunc(varnum(&handle,index_date)) > 0 %then %do;
    %let rc=%sysfunc(close(&handle));
    %put ERROR: &ds already contains index_date. Rename it before adding the cohort index.;
    %abort cancel;
  %end;
  %let rc=%sysfunc(close(&handle));
%mend;

%macro rg_count(step,label);
  proc sql;
    insert into work._rg_attrition (step,criterion,remaining)
    select &step,"&label",count(*) from work._rg_cohort;
  quit;
  %rg_checkpoint(attrition);
%mend;

%macro rg_events(rule_id,domain,table,enc_types,lower=&data_start,upper=&data_end);
  %local k ds year dt field filter keep;
  %let dt=ADate;
  %let keep=PatID EncounterID ADate EncType;
  %if &domain=DX or &domain=DX9 %then %do;
    %let field=DX;
    %let keep=&keep DX DX_CodeType;
    %if &domain=DX %then %let filter=DX_CodeType='10';
    %else %let filter=DX_CodeType='09';
  %end;
  %else %if &domain=DRG %then %do;
    %let field=DRG;
    %let keep=&keep DRG DRG_Type;
    %let filter=DRG_Type='2';
  %end;
  %else %if &domain=NDC %then %do;
    %let dt=RxDate;
    %let field=NDC;
    %let keep=PatID RxDate NDC;
    %let filter=1;
  %end;
  %else %do;
    %let field=PX;
    %let keep=&keep PX PX_CodeType;
    %if &domain=PCS %then %let filter=PX_CodeType='10';
    %else %if &domain=PX9 %then %let filter=PX_CodeType='09';
    %else %if &domain=CPT %then %let filter=PX_CodeType in ('C2','C3','C4');
    %else %let filter=PX_CodeType='HC';
  %end;
  data work._rg_events;
    length PatID %if &patid_type=C %then %do; $&patid_length %end; %else %do; 8 %end; EncounterID $&encounterid_length
      event_date source_year 8 source $3 source_file $41 code $18;
    stop;
  run;
  %do k=1 %to %sysfunc(countw(&&files_&table,%str( )));
    %let ds=%scan(&&files_&table,&k,%str( ));
    %let year=%scan(&&years_&table,&k,%str( ));
    data work._rg_matching;
      length PatID %if &patid_type=C %then %do; $&patid_length %end; %else %do; 8 %end; EncounterID $&encounterid_length
        event_date source_year 8 source $3 source_file $41 code $18
        _value $32767 match_type $6;
      if _n_=1 then do;
        declare hash selected(dataset:"work._rg_codes(where=(rule_id=&rule_id))");
        selected.defineKey('code','match_type');
        selected.defineDone();
        call missing(code,match_type);
      end;
      set &ds(keep=&keep);
      where &dt >= &lower and &dt <= &upper and (&filter);
      if missing(PatID) or missing(&dt) then delete;
      %if &domain ne NDC %then %do;
        if findw("&enc_types",strip(EncType),' ')=0 then delete;
      %end;
      %else %do;
        call missing(EncounterID);
      %end;
      _value=compress(upcase(strip(&field)),'. ');
      if missing(_value) or lengthn(_value)>18 then delete;
      %if &domain=PCS %then %do;
        if not prxmatch('/^[0-9A-HJ-NP-Z]{7}$/',strip(_value)) then delete;
      %end;
      code=_value;
      match_type='EXACT';
      _match=(selected.check()=0);
      match_type='PREFIX';
      do _prefix=1 to lengthn(_value) while (not _match);
        code=substr(_value,1,_prefix);
        _match=(selected.check()=0);
      end;
      if _match;
      code=_value;
      event_date=&dt;
      source="&table";
      source_file="&ds";
      source_year=&year;
      keep PatID EncounterID event_date source_year source source_file code;
    run;
    %rg_checkpoint(reading &ds);
    proc append base=work._rg_events data=work._rg_matching; run;
    %rg_checkpoint(appending events);
  %end;
%mend;

%macro rg_extracts(action);
  %local k j table ds year suffix target dt;
  %do k=1 %to %sysfunc(countw(%superq(outputs),%str( )));
    %let table=%scan(&outputs,&k);
    %do j=1 %to %sysfunc(countw(&&files_&table,%str( )));
      %let ds=%scan(&&files_&table,&j,%str( ));
      %let year=%scan(&&years_&table,&j,%str( ));
      %let suffix=&table;
      %if &year ne 0 %then %let suffix=&table._&year;
      %let target=cut_&suffix;
      %if &action=CHECK %then %do;
        %if %sysfunc(exist(&outlib..&target)) or %sysfunc(exist(&outlib..&target,VIEW)) %then %do;
          %put ERROR: &outlib..&target already exists. Use a fresh output library.;
          %abort cancel;
        %end;
      %end;
      %else %if &action=PREPARE %then %do;
        %let dt=ADate;
        %if &table=DIS %then %let dt=RxDate;
        proc sql;
          create table work._rg_&target as
          select e.*,c.index_date from &ds e inner join work._rg_cohort c on e.PatID=c.PatID
          %if &table=ENR %then %do;
            where not missing(e.Enr_Start) and not missing(e.Enr_End) and e.Enr_Start<=e.Enr_End
              and e.Enr_Start<=c.index_date+&extract_after and e.Enr_End>=c.index_date-&extract_before
          %end;
          %else %if &table ne DEM and &table ne DEA %then %do;
            where not missing(e.&dt) and e.&dt>=c.index_date-&extract_before and e.&dt<=c.index_date+&extract_after
          %end;
          ;
        quit;
        %rg_checkpoint(extracting &ds);
        proc sql;
          insert into work._rg_extract_counts (dataset,rows,people)
          select "&target",count(*),count(distinct PatID) from work._rg_&target;
        quit;
        %rg_checkpoint(counting &target);
      %end;
      %else %do;
        data &outlib..&target; set work._rg_&target; run;
        %rg_checkpoint(delivering &target);
      %end;
    %end;
  %end;
%mend;

%macro rg_preflight;
  %local k table output_overlap;
  %if %sysfunc(libref(&outlib)) ne 0 %then %do;
    %put ERROR: Assign output library &outlib before running ROGER.;
    %abort cancel;
  %end;
  %if %upcase(&outlib) ne WORK and %sysfunc(libref(MS))=0 %then %do;
    %let output_overlap=0;
    data _null_;
      length source output $1024;
      source=lowcase(tranwrd(strip(pathname('MS')),'\','/'));
      output=lowcase(tranwrd(strip(pathname("&outlib")),'\','/'));
      source=prxchange('s@/+$@@',1,source);
      output=prxchange('s@/+$@@',1,output);
      if not missing(source) and
        (output=source or substr(output,1,lengthn(source)+1)=cats(source,'/'))
        then call symputx('output_overlap',1,'L');
    run;
    %if &output_overlap %then %do;
      %put ERROR: Output library overlaps the MS source library. Use a separate output folder.;
      %abort cancel;
    %end;
  %end;
  %do k=1 %to 12;
    %let table=%scan(cohort attrition definition rules code_sets input_manifest covariate_specs diagnostics counts missingness extract_counts cohort_preview,&k);
    %if %sysfunc(exist(&outlib..&table)) or %sysfunc(exist(&outlib..&table,VIEW)) %then %do;
      %put ERROR: &outlib..&table already exists. Use a fresh output library.;
      %abort cancel;
    %end;
  %end;
  %rg_extracts(CHECK);
  %rg_check_inputs;
  data work._rg_attrition;
    length step remaining 8 criterion $160;
    stop;
  run;
  %put NOTE: ROGER preflight passed. Required source files and output names were checked.;
%mend;

%macro rg_covariate(cov_id,domain,table,enc_types,lower,upper,days,key);
  %rg_events(&cov_id,&domain,&table,&enc_types,
    lower=%sysfunc(sum(&index_start,&lower)),upper=%sysfunc(sum(&index_end,&upper)));
  proc sql;
    create table work._rg_cov_hits as
    select c.PatID,count(distinct e.event_date) as hit_days
    from work._rg_cohort c left join work._rg_events e
      on c.PatID=e.PatID and e.event_date>=c.index_date+&lower
      and e.event_date<=c.index_date+&upper
    group by c.PatID;
    create table work._rg_next as
    select c.*,coalesce(h.hit_days,0) as cov_&key._days,
      (calculated cov_&key._days >= &days) as cov_&key
    from work._rg_cohort c left join work._rg_cov_hits h on c.PatID=h.PatID;
  quit;
  data work._rg_cohort; set work._rg_next; run;
  %rg_checkpoint(covariate &key);
%mend;

%macro rg_index_stage;
  %local domain sources enc_types;
  proc sql noprint;
    select domain,sources,enc_types into :domain trimmed,:sources trimmed,:enc_types trimmed
      from work._rg_rules where rule_id=1;
  quit;
  %rg_events(1,&domain,&sources,&enc_types,lower=&index_start,upper=&index_end);
  proc sort data=work._rg_events(where=(event_date>=&index_start and event_date<=&index_end)) out=work._rg_index;
    by PatID %if &index_order=LAST %then %do; descending %end; event_date source_file EncounterID code;
  run;
  data work._rg_cohort;
    set work._rg_index;
    by PatID;
    if first.PatID;
    index_date=event_date;
    format index_date yymmdd10.;
    rename EncounterID=index_encounter source=index_source source_file=index_file source_year=index_file_year code=index_code;
    drop event_date;
  run;
  %rg_checkpoint(index selection);
  %rg_count(1,&index_order matching index event);
%mend;

%macro rg_eligibility_stage;
  %local n_rules rid domain sources enc_types mode days lower upper duplicates;
  proc sql;
    create table work._rg_next as
    select c.*,d.Birth_Date,d.Sex from work._rg_cohort c left join &files_DEM d on c.PatID=d.PatID;
  quit;
  %rg_checkpoint(demographic join);
  proc sql noprint;
    select count(*)-count(distinct PatID) into :duplicates trimmed from work._rg_next;
  quit;
  %rg_checkpoint(demographic uniqueness);
  %if &duplicates > 0 %then %do;
    %put ERROR: Demographic contains repeated PatID values among index-selected people. Resolve duplicates before selection.;
    %abort cancel;
  %end;
  data work._rg_cohort;
    set work._rg_next;
    if missing(Birth_Date) or Birth_Date>index_date then delete;
    age_at_index=intck('year',Birth_Date,index_date,'c');
    if age_at_index<&age_min or age_at_index>&age_max then delete;
    %if &sex ne ALL %then %do; if Sex ne "&sex" then delete; %end;
  run;
  %rg_checkpoint(demographics);
  %rg_count(2,Demographic requirements);

  %if &enrollment=1 %then %do;
    proc sql;
      create table work._rg_intervals as
      select c.PatID,c.index_date,max(e.Enr_Start,c.index_date-&baseline) as span_start,
        min(e.Enr_End,c.index_date+&followup) as span_end
      from work._rg_cohort c inner join &files_ENR e on c.PatID=e.PatID
      where not missing(e.Enr_Start) and not missing(e.Enr_End) and e.Enr_Start<=e.Enr_End
        and e.Enr_Start<=c.index_date+&followup and e.Enr_End>=c.index_date-&baseline
        and e.MedCov='Y'
        %if &rx=1 %then %do; and e.DrugCov='Y' %end;
      order by PatID,span_start,span_end;
    quit;
    %rg_checkpoint(enrollment intervals);
    data work._rg_eligible;
      set work._rg_intervals;
      by PatID;
      retain covered_start covered_end max_gap;
      if first.PatID then do;
        covered_start=span_start; covered_end=span_end; max_gap=0;
      end;
      else do;
        max_gap=max(max_gap,span_start-covered_end-1);
        covered_end=max(covered_end,span_end);
      end;
      if last.PatID and covered_start<=index_date-&baseline and covered_end>=index_date+&followup and max_gap<=&gap then output;
      keep PatID;
    run;
    proc sql;
      create table work._rg_next as select c.* from work._rg_cohort c inner join work._rg_eligible e on c.PatID=e.PatID;
    quit;
    data work._rg_cohort; set work._rg_next; run;
    %rg_checkpoint(enrollment eligibility);
    %rg_count(3,Enrollment requirements);
  %end;
  proc sql noprint;
    select count(*) into :n_rules trimmed from work._rg_rules;
  quit;
  %do rid=2 %to &n_rules;
    proc sql noprint;
      select domain,sources,enc_types,mode,min_days,lower_day,upper_day
        into :domain trimmed,:sources trimmed,:enc_types trimmed,:mode trimmed,:days trimmed,:lower trimmed,:upper trimmed
        from work._rg_rules where rule_id=&rid;
    quit;
    %rg_events(&rid,&domain,&sources,&enc_types,
      lower=%sysfunc(sum(&index_start,&lower)),upper=%sysfunc(sum(&index_end,&upper)));
    proc sql;
      create table work._rg_hitcounts as
      select c.PatID,count(distinct e.event_date) as hit_days
      from work._rg_cohort c left join work._rg_events e
        on c.PatID=e.PatID and e.event_date >= c.index_date+&lower
        and e.event_date <= c.index_date+&upper
      group by c.PatID;
      create table work._rg_next as select c.*
      %if &advanced_logic=1 %then %do;
        , (h.hit_days %if &mode=INCLUDE %then %do; >= %end; %else %do; < %end; &days) as _rg_pass_&rid
      %end;
      from work._rg_cohort c
      inner join work._rg_hitcounts h on c.PatID=h.PatID
      %if &advanced_logic=0 %then %do;
        %if &mode=INCLUDE %then %do; where h.hit_days >= &days %end;
        %else %do; where h.hit_days < &days %end;
      %end;
      ;
    quit;
    data work._rg_cohort; set work._rg_next; run;
    %rg_checkpoint(rule &rid);
    %if &advanced_logic=0 %then %rg_count(%eval(&rid+2),&mode rule &rid - &domain);
  %end;

  %if &advanced_logic=1 %then %do;
    %rg_apply_logic;
    %rg_checkpoint(condition tree);
    %rg_count(%eval(&n_rules+3),Combined AND OR condition tree);
  %end;
%mend;

%macro rg_delivery_stage;
  data work._rg_extract_counts;
    length dataset $32 rows people 8;
    stop;
  run;
  %rg_extracts(PREPARE);
  data &outlib..cohort; set work._rg_cohort; run;
  data &outlib..attrition;
    set work._rg_attrition;
    retain initial previous;
    if _n_=1 then do; initial=remaining; previous=remaining; end;
    removed=previous-remaining;
    if initial > 0 then proportion_remaining=remaining/initial;
    previous=remaining;
    drop previous initial;
  run;
  data &outlib..definition; set work._rg_definition; run;
  data &outlib..rules; set work._rg_rules; run;
  data &outlib..code_sets; set work._rg_codes; run;
  data &outlib..input_manifest; set work._rg_manifest; run;
  data &outlib..covariate_specs; set work._rg_covariates; run;
  data &outlib..extract_counts; set work._rg_extract_counts; run;
  data &outlib..cohort_preview;
    set work._rg_cohort(obs=200 drop=PatID Birth_Date index_encounter);
    preview_row=_n_;
  run;
  %rg_checkpoint(audit delivery);
  %rg_extracts(DELIVER);
  %rg_diagnostics;
  title "ROGER CDM cohort attrition";
  proc print data=&outlib..attrition noobs; run;
  title;
  %put NOTE: ROGER CDM completed. Outputs are in &outlib..;
%mend;

%macro rg_diagnostics;
  %local people;
  proc sql noprint;
    select count(*) into :people trimmed from work._rg_cohort;
  quit;
  proc sql;
    create table &outlib..diagnostics as
    select count(*) as people, count(distinct PatID) as distinct_people,
      min(index_date) format=yymmdd10. as first_index,
      max(index_date) format=yymmdd10. as last_index,
      mean(age_at_index) format=8.2 as mean_age,
      min(age_at_index) as min_age,max(age_at_index) as max_age
    from work._rg_cohort;
  quit;
  data work._rg_count_rows;
    set work._rg_cohort;
    length dimension $40 value $64;
    dimension='Sex'; value=ifc(missing(Sex),'(missing)',strip(Sex)); output;
    dimension='Index source'; value=ifc(missing(index_source),'(missing)',strip(index_source)); output;
    dimension='Index month'; value=put(index_date,yymmn6.); output;
    dimension='Age band'; value=cats(put(floor(age_at_index/10)*10,3.),'s'); output;
    %rg_covariate_counts;
    keep dimension value;
  run;
  proc sql;
    create table &outlib..counts as
    select dimension,value,count(*) as people,
      %if &people > 0 %then %do; calculated people/&people*100 %end;
      %else %do; . %end; as percent format=6.2
    from work._rg_count_rows
    group by dimension,value
    order by dimension,people desc,value;
  quit;
  data work._rg_missing_rows;
    set work._rg_cohort;
    length variable $32 is_missing 8;
    variable='Sex'; is_missing=missing(Sex); output;
    variable='Birth_Date'; is_missing=missing(Birth_Date); output;
    variable='age_at_index'; is_missing=missing(age_at_index); output;
    variable='index_date'; is_missing=missing(index_date); output;
    %rg_covariate_missing;
    keep variable is_missing;
  run;
  proc sql;
    create table &outlib..missingness as
    select variable,count(*) as total,sum(is_missing) as missing,
      %if &people > 0 %then %do; calculated missing/&people*100 %end;
      %else %do; . %end; as percent_missing format=6.2
    from work._rg_missing_rows group by variable order by variable;
  quit;
  %rg_checkpoint(diagnostics);
  title 'ROGER cohort diagnostics';
  proc print data=&outlib..diagnostics noobs; run;
  proc print data=&outlib..counts noobs; run;
  proc print data=&outlib..missingness noobs; run;
  proc print data=&outlib..extract_counts noobs; run;
  title;
%mend;

%macro rg_stage_report(label);
  %rg_checkpoint(&label stage);
  title "ROGER &label stage diagnostic";
  proc sql;
    select count(*) as people_remaining, count(distinct PatID) as distinct_people,
      min(index_date) format=yymmdd10. as first_index,
      max(index_date) format=yymmdd10. as last_index
    from work._rg_cohort;
  quit;
  proc print data=work._rg_attrition noobs; run;
  title;
%mend;

%macro rg_stage_integrity(label);
  %local people distinct_people bad_keys;
  %if not %sysfunc(exist(work._rg_cohort)) %then %do;
    %put ERROR: &label add-on removed WORK._RG_COHORT.;
    %abort cancel;
  %end;
  proc sql noprint;
    select count(*),count(distinct PatID),
      coalesce(sum(missing(PatID) or missing(index_date)),0)
      into :people trimmed,:distinct_people trimmed,:bad_keys trimmed
    from work._rg_cohort;
  quit;
  %rg_checkpoint(&label add-on);
  %if &people ne &distinct_people or &bad_keys > 0 %then %do;
    %put ERROR: &label add-on must preserve one row per person and nonmissing PatID/index_date.;
    %abort cancel;
  %end;
%mend;

%macro roger_cdm_cut;
  %rg_preflight;
  %rg_index_stage;
  %rg_stage_report(index);
  %if &stop_after=INDEX %then %return;
  %rg_addon_after_index;
  %rg_stage_integrity(index);
  %rg_eligibility_stage;
  %rg_stage_report(eligibility);
  %if &stop_after=ELIGIBILITY %then %return;
  %rg_addon_after_eligibility;
  %rg_stage_integrity(eligibility);
  %rg_build_covariates;
  %rg_stage_integrity(covariates);
  %rg_delivery_stage;
%mend;
