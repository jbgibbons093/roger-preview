/* SYNTHETIC CDM ACCEPTANCE CHECK. Run in a fresh SAS 9.4 session.
   No real patient records are included. Expected results have not been run here.
   PASS expects IDs 001 and 0000000000000000000002, counts 8 7 4 2.
   Set fixture_case to MISSING_YEAR, WRONG_PATID, BAD_ROLLUP, or DUP_DEM
   in separate fresh sessions to verify the corresponding preflight abort.
   Negative cases must stop before creating COHORT or any CUT_ output. */
%let fixture_case=PASS;
options errorabend;
libname MS "%sysfunc(pathname(work))";
%macro fixture_guard;
  %if %sysfunc(exist(MS.Demographic_2014_2015)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Death_2014_2015)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Enrollment_abd_2014_2015_rollup)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Encounter_2014)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Encounter_2015)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Diagnosis_2014)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Diagnosis_2015)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Procedure_2014)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Procedure_2015)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Dispensing_2014)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
  %if %sysfunc(exist(MS.Dispensing_2015)) %then %do; %put ERROR: Fixture input already exists. Use a fresh SAS session.; %abort cancel; %end;
%mend;
%fixture_guard;
data MS.Demographic_2014_2015;
  length PatID $64 Birth_Date 8 Sex $1;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$64. Birth_Date :date9. Sex :$1.;
datalines4;
001|01JAN1970|F
1|01JAN1970|F
0000000000000000000002|10OCT1997|F
004|01JAN1970|F
005|01JAN1970|F
006|01JAN1970|F
007|01JAN1970|F
008|.|F
;;;;
run;
data MS.Enrollment_abd_2014_2015_rollup;
  length PatID $64 Enr_Start Enr_End 8 MedCov DrugCov $1;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$64. Enr_Start :date9. Enr_End :date9. MedCov :$1. DrugCov :$1.;
datalines4;
001|01JAN2014|31DEC2015|Y|Y
1|01JAN2014|31DEC2015|Y|Y
0000000000000000000002|01JAN2014|31DEC2015|Y|Y
004|01JAN2014|31DEC2015|Y|Y
005|01JAN2014|31DEC2015|N|Y
006|01JAN2014|31DEC2015|U|Y
007|01JAN2014|31DEC2015|Y|N
008|01JAN2014|31DEC2015|Y|Y
;;;;
run;
data MS.Death_2014_2015;
  length PatID $64 DeathDt 8 DtImpute Source Confidence $1;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$64. DeathDt :date9. DtImpute :$1. Source :$1. Confidence :$1.;
datalines4;
001|01DEC2015|N|S|E
;;;;
run;
data MS.Diagnosis_2014;
  length PatID $40 EncounterID $20 ADate 8 EncType $2 DX $18 DX_CodeType $2 ExtraText $8;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$60. EncounterID :$20. ADate :date9. EncType :$2. DX :$18. DX_CodeType :$2.;
datalines4;
001|orphan|01DEC2014|AV|250.00|09
1|orphan|01DEC2014|AV|250.00|09
0000000000000000000002|orphan|01DEC2014|AV|250.00|09
004|orphan|01DEC2014|AV|250.00|10
005|orphan|01DEC2014|AV|250.00|09
006|orphan|01DEC2014|AV|250.00|09
007|orphan|01DEC2014|AV|250.00|09
008|orphan|01DEC2014|AV|250.00|09
001|orphan|01DEC2014|AV|250.00|09
;;;;
run;
data MS.Procedure_2014; length PatID $64 EncounterID $20 ADate 8 EncType $2 PX $11 PX_CodeType $2; stop; run;
data MS.Dispensing_2014; length PatID $64 RxDate 8 NDC $11; stop; run;
data MS.Encounter_2014; length PatID $64 EncounterID $20 ADate 8 EncType $2 DRG $3 DRG_Type $1; stop; run;
data MS.Diagnosis_2015;
  length PatID $60 EncounterID $20 ADate 8 EncType $2 DX $18 DX_CodeType $2 ExtraText $100;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$60. EncounterID :$20. ADate :date9. EncType :$2. DX :$18. DX_CodeType :$2.;
datalines4;
001|orphan|01SEP2015|AV|250.00|09
1|orphan|01SEP2015|AV|250.00|09
0000000000000000000002|orphan|01SEP2015|AV|250.00|09
004|orphan|01SEP2015|AV|250.00|10
005|orphan|01SEP2015|AV|250.00|09
006|orphan|01SEP2015|AV|250.00|09
007|orphan|01SEP2015|AV|250.00|09
008|orphan|01SEP2015|AV|250.00|09
001|orphan|01OCT2015|AV|E11.9|10
001|orphan|15OCT2015|AV|E11.9|10
1|orphan|01OCT2015|AV|E11.9|10
1|orphan|15OCT2015|AV|E11.9|10
0000000000000000000002|orphan|01OCT2015|AV|E11.9|10
0000000000000000000002|orphan|15OCT2015|AV|E11.9|10
004|orphan|01OCT2015|AV|E11.9|10
004|orphan|15OCT2015|AV|E11.9|10
005|orphan|01OCT2015|AV|E11.9|10
005|orphan|15OCT2015|AV|E11.9|10
006|orphan|01OCT2015|AV|E11.9|10
006|orphan|15OCT2015|AV|E11.9|10
007|orphan|01OCT2015|AV|E11.9|10
007|orphan|15OCT2015|AV|E11.9|10
008|orphan|01OCT2015|AV|E11.9|10
008|orphan|15OCT2015|AV|E11.9|10
001|orphan|01SEP2015|AV|250.00|09
;;;;
run;
data MS.Procedure_2015;
  length PatID $64 EncounterID $20 ADate 8 EncType $2 PX $11 PX_CodeType $2;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$64. EncounterID :$20. ADate :date9. EncType :$2. PX :$11. PX_CodeType :$2.;
datalines4;
001|orphan|01OCT2015|AV|99213|C4
0000000000000000000002|orphan|01OCT2015|AV|4000F|C2
1|orphan|01OCT2015|AV|J0178|HC
004|orphan|01OCT2015|AV|99213|C4
001|pcs|02OCT2015|IP|0JH60DZ|10
004|bad-pcs|02OCT2015|IP|3893|10
001|ndc-proc|02OCT2015|AV|00000000001|ND
;;;;
run;
data MS.Dispensing_2015;
  length PatID $64 RxDate 8 NDC $11;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$64. RxDate :date9. NDC :$11.;
datalines4;
1|01OCT2015|00000000001
;;;;
run;
data MS.Encounter_2015;
  length PatID $64 EncounterID $20 ADate 8 EncType $2 DRG $3 DRG_Type $1;
  infile datalines4 dlm='|' dsd truncover;
  input PatID :$64. EncounterID :$20. ADate :date9. EncType :$2. DRG :$3. DRG_Type :$1.;
datalines4;
001|drg|01OCT2015|IP|001|2
004|old-drg|01OCT2015|IP|001|1
;;;;
run;
%macro negative_case;
  %if &fixture_case=MISSING_YEAR %then %do; proc datasets lib=MS nolist; delete Diagnosis_2014; quit; %end;
  %if &fixture_case=WRONG_PATID %then %do;
    data MS.Diagnosis_2014; set MS.Diagnosis_2014(rename=(PatID=old_id)); PatID=input(old_id,32.); drop old_id; run;
  %end;
  %if &fixture_case=BAD_ROLLUP %then %do;
    data MS.Enrollment_abd_2014_2015_rollup; set MS.Enrollment_abd_2014_2015_rollup; drop MedCov; run;
  %end;
  %if &fixture_case=DUP_DEM %then %do;
    data work._rg_fixture_duplicate; set MS.Demographic_2014_2015(obs=1); run;
    proc append base=MS.Demographic_2014_2015 data=work._rg_fixture_duplicate; run;
  %end;
%mend;
%negative_case;
/* ROGER Mini-Sentinel CDM v3.0. SAS 9.4.
   Filename conventions supplied by the institution. Delivery years 2014-2015.
   Confirm the delivery range and mappings before execution.
   Preflight requires the documented CDM fields, including the enrollment rollup.
   Patient identifiers remain character values. Death never changes enrollment.
   This program has not been executed by the browser. WORK._RG_ is reserved.
*/
options errorabend;
/* Assign the input librefs in this SAS session before running. */
/* Outputs use WORK. Start a fresh SAS session for each run. */
%let age_min=18;
%let age_max=64;
%let sex=ALL;
%let enrollment=1;
%let baseline=365;
%let followup=0;
%let gap=0;
%let rx=1;
%let extract_before=365;
%let extract_after=0;
%let outputs=DEM DEA ENR ENC DIA PRO DIS;
%let outlib=WORK;
%let index_order=LAST;
%let advanced_logic=1;
%let index_start=%sysfunc(inputn(20151001,yymmdd8.));
%let index_end=%sysfunc(inputn(20151015,yymmdd8.));
%let data_start='01JAN2014'd;
%let data_end='31DEC2015'd;
%let files_DEM=MS.Demographic_2014_2015;
%let years_DEM=0;
%let files_DEA=MS.Death_2014_2015;
%let years_DEA=0;
%let files_ENR=MS.Enrollment_abd_2014_2015_rollup;
%let years_ENR=0;
%let files_ENC=MS.Encounter_2014 MS.Encounter_2015;
%let years_ENC=2014 2015;
%let files_DIA=MS.Diagnosis_2014 MS.Diagnosis_2015;
%let years_DIA=2014 2015;
%let files_PRO=MS.Procedure_2014 MS.Procedure_2015;
%let years_PRO=2014 2015;
%let files_DIS=MS.Dispensing_2014 MS.Dispensing_2015;
%let years_DIS=2014 2015;

data work._rg_definition;
  length name $120 schema_id $40 logic_json $12000 input_path output_path $250;
  name='Synthetic CDM acceptance'; schema_id='mini-sentinel-cdm-3.0-v1';
  year_start=2014; year_end=2015;
  logic_json='{"id":"g0","op":"AND","children":[0,{"id":"g1","op":"OR","children":[1,2]},3]}';
  input_path=''; output_path='';
  index_start=&index_start; index_end=&index_end;
  created_at=datetime(); format created_at datetime20. index_start index_end yymmdd10.;
  age_min=18;
  age_max=64;
  sex='ALL';
  enrollment=1;
  baseline=365;
  followup=0;
  gap=0;
  rx=1;
  extract_before=365;
  extract_after=0;
  outputs='DEM DEA ENR ENC DIA PRO DIS';
  outlib='WORK';
  index_order='LAST';
  advanced_logic=1;
run;
data work._rg_rules;
  length rule_id min_days lower_day upper_day 8 mode $7 domain $5 sources $3 enc_types $14;
  infile datalines4 dlm='|' dsd truncover;
  input rule_id mode :$7. domain :$5. sources :$3. min_days lower_day upper_day enc_types :$14.;
datalines4;
1|INDEX|DX|DIA|1|0|0|AV ED IP IS OA
2|INCLUDE|DX9|DIA|2|-365|-1|AV ED IP IS OA
3|INCLUDE|CPT|PRO|1|-30|0|AV ED IP IS OA
4|INCLUDE|HCPCS|PRO|1|-30|0|AV ED IP IS OA
5|EXCLUDE|NDC|DIS|1|-30|0|AV ED IP IS OA
;;;;
run;
data work._rg_codes;
  length rule_id 8 code $18 match_type $6;
  infile datalines4 dlm='|' dsd truncover;
  input rule_id code :$18. match_type :$6.;
datalines4;
1|E119|EXACT
2|25000|EXACT
3|99213|EXACT
3|4000F|EXACT
4|J0178|EXACT
5|00000000001|EXACT
;;;;
run;
data work._rg_manifest;
  length source $3 dataset $41 file_year 8;
  infile datalines4 dlm='|' dsd truncover;
  input source :$3. dataset :$41. file_year;
datalines4;
DEM|MS.Demographic_2014_2015|.
DEA|MS.Death_2014_2015|.
ENR|MS.Enrollment_abd_2014_2015_rollup|.
ENC|MS.Encounter_2014|2014
ENC|MS.Encounter_2015|2015
DIA|MS.Diagnosis_2014|2014
DIA|MS.Diagnosis_2015|2015
PRO|MS.Procedure_2014|2014
PRO|MS.Procedure_2015|2015
DIS|MS.Dispensing_2014|2014
DIS|MS.Dispensing_2015|2015
;;;;
run;
%macro rg_apply_logic;
  data work._rg_cohort;
    set work._rg_cohort;
    if (_rg_pass_2=1 AND (_rg_pass_3=1 OR _rg_pass_4=1) AND _rg_pass_5=1);
    drop _rg_pass_:;
  run;
%mend;

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


%macro rg_check_inputs;
  %global patid_length encounterid_length;
  %let patid_length=1;
  %let encounterid_length=1;
  %rg_require(MS.Demographic_2014_2015,PatID Birth_Date Sex,C N C,1);
  %rg_require(MS.Death_2014_2015,PatID DeathDt DtImpute Source Confidence,C N C C C,1);
  %rg_require(MS.Enrollment_abd_2014_2015_rollup,PatID Enr_Start Enr_End MedCov DrugCov,C N N C C,1);
  %rg_require(MS.Encounter_2014,PatID EncounterID ADate EncType DRG DRG_Type,C C N C C C,1);
  %rg_require(MS.Encounter_2015,PatID EncounterID ADate EncType DRG DRG_Type,C C N C C C,1);
  %rg_require(MS.Diagnosis_2014,PatID EncounterID ADate EncType DX DX_CodeType,C C N C C C,1);
  %rg_require(MS.Diagnosis_2015,PatID EncounterID ADate EncType DX DX_CodeType,C C N C C C,1);
  %rg_require(MS.Procedure_2014,PatID EncounterID ADate EncType PX PX_CodeType,C C N C C C,1);
  %rg_require(MS.Procedure_2015,PatID EncounterID ADate EncType PX PX_CodeType,C C N C C C,1);
  %rg_require(MS.Dispensing_2014,PatID RxDate NDC,C N C,1);
  %rg_require(MS.Dispensing_2015,PatID RxDate NDC,C N C,1);
%mend;
%roger_cdm_cut;

%macro fixture_assertions;
  %local actual counts death_count date_errors h width rc;
  %if &fixture_case ne PASS %then %do;
    %put ERROR: The requested negative fixture failed to abort.; %abort cancel;
  %end;
  proc sql noprint;
    select PatID into :actual separated by '|' from work.cohort order by PatID;
    select remaining into :counts separated by ' ' from work.attrition order by step;
    select count(*) into :death_count trimmed from work.cut_DEA;
    select count(*) into :date_errors trimmed from work.cohort where index_date ne '15OCT2015'd or age_at_index<18;
  quit;
  %if %superq(actual) ne %str(0000000000000000000002|001) or %superq(counts) ne 8 7 4 2 or &death_count ne 1 or &date_errors ne 0 %then %do;
    %put ERROR: CDM mismatch. IDs=&actual counts=&counts death_count=&death_count date_errors=&date_errors;
    %abort cancel;
  %end;
  %let h=%sysfunc(open(work.cut_DIA_2015,i));
  %let width=%sysfunc(varlen(&h,%sysfunc(varnum(&h,ExtraText))));
  %let rc=%sysfunc(close(&h));
  %if &width ne 100 %then %do; %put ERROR: Annual extract attributes changed.; %abort cancel; %end;
  data work._rg_codes;
    length rule_id 8 code $18 match_type $6;
    rule_id=99; code='001'; match_type='EXACT'; output;
  run;
  %rg_events(99,DRG,ENC,IP);
  proc sql noprint; select count(*) into :actual trimmed from work._rg_events where PatID='001' and code='001'; select count(*) into :counts trimmed from work._rg_events; quit;
  %if &actual ne 1 or &counts ne 1 %then %do; %put ERROR: DRG type or zero preservation failed.; %abort cancel; %end;
  data work._rg_codes;
    length rule_id 8 code $18 match_type $6;
    rule_id=99; code='0JH'; match_type='PREFIX'; output;
    code='389'; output;
  run;
  %rg_events(99,PCS,PRO,IP);
  proc sql noprint; select count(*) into :actual trimmed from work._rg_events where PatID='001'; select count(*) into :counts trimmed from work._rg_events; quit;
  %if &actual ne 1 or &counts ne 1 %then %do; %put ERROR: PCS type or shape failed.; %abort cancel; %end;
  %rg_checkpoint(fixture assertions);
  %put NOTE: ROGER CDM SYNTHETIC ACCEPTANCE CHECK PASSED.;
%mend;
%fixture_assertions;
