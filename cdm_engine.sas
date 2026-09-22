/* ROGER Mini-Sentinel CDM v3.0 engine 1.0. SAS 9.4.
   Character identifiers are sized from every required input before scanning.
   Annual extracts remain separate to preserve each source file's attributes. */

%macro rg_checkpoint(label);
  %if &syserr > 4 or &syscc > 4 %then %do;
    %put ERROR: ROGER stopped after &label.. Review the SAS log.;
    %abort cancel;
  %end;
%mend;

%macro rg_require(ds, vars, types, extract);
  %local handle j variable position expected rc width;
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
    %if %sysfunc(vartype(&handle,&position)) ne &expected %then %do;
      %let rc=%sysfunc(close(&handle));
      %put ERROR: Unexpected type for &variable in &ds.. CDM PatID must remain character.;
      %abort cancel;
    %end;
    %let width=%sysfunc(varlen(&handle,&position));
    %if %upcase(&variable)=PATID %then %let patid_length=%sysfunc(max(&patid_length,&width));
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

%macro rg_events(rule_id,domain,table,enc_types);
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
    length PatID $&patid_length EncounterID $&encounterid_length
      event_date source_year 8 source $3 source_file $41 code $18;
    stop;
  run;
  %do k=1 %to %sysfunc(countw(&&files_&table,%str( )));
    %let ds=%scan(&&files_&table,&k,%str( ));
    %let year=%scan(&&years_&table,&k,%str( ));
    data work._rg_matching;
      length PatID $&patid_length EncounterID $&encounterid_length
        event_date source_year 8 source $3 source_file $41 code $18
        _value $32767 match_type $6;
      if _n_=1 then do;
        declare hash selected(dataset:"work._rg_codes(where=(rule_id=&rule_id))");
        selected.defineKey('code','match_type');
        selected.defineDone();
        call missing(code,match_type);
      end;
      set &ds(keep=&keep);
      where &dt >= &data_start and &dt <= &data_end and (&filter);
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
      %end;
      %else %do;
        data &outlib..&target; set work._rg_&target; run;
        %rg_checkpoint(delivering &target);
      %end;
    %end;
  %end;
%mend;

%macro roger_cdm_cut;
  %local n_rules rid domain sources enc_types mode days lower upper k table duplicates;
  %if %sysfunc(libref(&outlib)) ne 0 %then %do;
    %put ERROR: Assign output library &outlib before running ROGER.;
    %abort cancel;
  %end;
  %do k=1 %to 6;
    %let table=%scan(cohort attrition definition rules code_sets input_manifest,&k);
    %if %sysfunc(exist(&outlib..&table)) or %sysfunc(exist(&outlib..&table,VIEW)) %then %do;
      %put ERROR: &outlib..&table already exists. Use a fresh output library.;
      %abort cancel;
    %end;
  %end;
  %rg_extracts(CHECK);
  %rg_check_inputs;
  proc sql noprint;
    create table work._rg_duplicate_ids as
    select PatID from &files_DEM where not missing(PatID) group by PatID having count(*)>1;
    select count(*) into :duplicates trimmed from work._rg_duplicate_ids;
  quit;
  %rg_checkpoint(demographic uniqueness);
  %if &duplicates > 0 %then %do;
    %put ERROR: Demographic contains repeated PatID values. Resolve duplicates before selection.;
    %abort cancel;
  %end;
  data work._rg_attrition;
    length step remaining 8 criterion $160;
    stop;
  run;
  proc sql noprint;
    select domain,sources,enc_types into :domain trimmed,:sources trimmed,:enc_types trimmed
      from work._rg_rules where rule_id=1;
    select count(*) into :n_rules trimmed from work._rg_rules;
  quit;
  %rg_events(1,&domain,&sources,&enc_types);
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
  proc sql;
    create table work._rg_next as
    select c.*,d.Birth_Date,d.Sex from work._rg_cohort c left join &files_DEM d on c.PatID=d.PatID;
  quit;
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
  %do rid=2 %to &n_rules;
    proc sql noprint;
      select domain,sources,enc_types,mode,min_days,lower_day,upper_day
        into :domain trimmed,:sources trimmed,:enc_types trimmed,:mode trimmed,:days trimmed,:lower trimmed,:upper trimmed
        from work._rg_rules where rule_id=&rid;
    quit;
    %rg_events(&rid,&domain,&sources,&enc_types);
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
  %rg_checkpoint(audit delivery);
  %rg_extracts(DELIVER);
  title "ROGER CDM cohort attrition";
  proc print data=&outlib..attrition noobs; run;
  title;
  %put NOTE: ROGER CDM completed. Outputs are in &outlib..;
%mend;
