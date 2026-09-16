/* ROGER cohort engine 0.1.0. SAS 9.4.
   Input mappings use the 2023 Commercial/Medicare data dictionary.
   Work tables beginning _rg_ are reserved for this run.
   Claims and enrollment remain in SAS. The browser supplies definitions only. */

%macro rg_require(ds, vars, types);
  %local handle j variable position expected rc;
  %let handle=%sysfunc(open(&ds,i));
  %if &handle=0 %then %do;
    %put ERROR: ROGER cannot open &ds.. Assign the input library and table mappings.;
    %abort cancel;
  %end;
  %do j=1 %to %sysfunc(countw(&vars));
    %let variable=%scan(&vars,&j);
    %let expected=%scan(&types,&j);
    %let position=%sysfunc(varnum(&handle,&variable));
    %if &position=0 %then %do;
      %let rc=%sysfunc(close(&handle));
      %put ERROR: ROGER expected &variable in &ds.. Check the 2023 schema.;
      %abort cancel;
    %end;
    %if %sysfunc(vartype(&handle,&position)) ne &expected %then %do;
      %let rc=%sysfunc(close(&handle));
      %put ERROR: ROGER found an unexpected type for &variable in &ds..;
      %abort cancel;
    %end;
  %end;
  %let rc=%sysfunc(close(&handle));
%mend;

%macro rg_checkpoint(label);
  %if &syserr > 4 or &syscc > 4 %then %do;
    %put ERROR: ROGER stopped after &label.. Review the SAS log.;
    %abort cancel;
  %end;
%mend;

%macro rg_count(step, label);
  proc sql;
    insert into work._rg_attrition (step,criterion,remaining)
    select &step, "&label", count(*) from work._rg_cohort;
  quit;
  %rg_checkpoint(attrition);
%mend;

%macro rg_events(rule_id, domain, sources);
  %local k table ds dt fields fieldtypes j filter;
  data work._rg_events;
    length ENROLID event_date AGE SEQNUM 8 SEX source $1 code $11;
    stop;
  run;
  %do k=1 %to %sysfunc(countw(&sources));
    %let table=%scan(&sources,&k);
    %let ds=&&map_&table;
    %let dt=SVCDATE;
    %if &table=I %then %let dt=ADMDATE;
    %let filter=1;
    %if &domain=DX %then %do;
      %rg_require(&ds,DXVER,C);
      %let filter=DXVER='0';
      %let fields=DX1 DX2 DX3 DX4;
      %if &table=S %then %let fields=PDX DX1 DX2 DX3 DX4;
      %if &table=F %then %let fields=DX1 DX2 DX3 DX4 DX5 DX6 DX7 DX8 DX9;
      %if &table=I %then %let fields=PDX DX1 DX2 DX3 DX4 DX5 DX6 DX7 DX8 DX9 DX10 DX11 DX12 DX13 DX14 DX15;
    %end;
    %else %if &domain=NDC %then %let fields=NDCNUM;
    %else %do;
      %let fields=PROC1;
      %rg_require(&ds,PROCTYP,C);
      %if &domain=CPT %then %let filter=PROCTYP='1';
      %else %let filter=PROCTYP='7';
    %end;
    %let fieldtypes=;
    %do j=1 %to %sysfunc(countw(&fields));
      %let fieldtypes=&fieldtypes C;
    %end;
    %rg_require(&ds,ENROLID &dt AGE SEX SEQNUM YEAR &fields,N N N C N N &fieldtypes);
    data work._rg_matching;
      length ENROLID event_date AGE SEQNUM 8 SEX source $1 code _value $11 match_type $6;
      /* Match during the scan so nonmatching diagnosis rows never reach WORK. */
      if _n_=1 then do;
        declare hash selected(dataset:"work._rg_codes(where=(rule_id=&rule_id))");
        selected.defineKey('code','match_type');
        selected.defineDone();
        call missing(code,match_type);
      end;
      set &ds;
      where YEAR=2023 and &dt >= '01JAN2023'd and &dt <= '31DEC2023'd and (&filter);
      if missing(ENROLID) or missing(&dt) then delete;
      event_date=&dt;
      source="&table";
      array codes {*} $ &fields;
      do _j=1 to dim(codes);
        _value=compress(upcase(strip(codes[_j])),'. ');
        if not missing(_value) then do;
          code=_value;
          match_type='EXACT';
          _match=(selected.check()=0);
          match_type='PREFIX';
          do _prefix=1 to lengthn(_value) while (not _match);
            code=substr(_value,1,_prefix);
            _match=(selected.check()=0);
          end;
          if _match then do;
            code=_value;
            output;
            leave;
          end;
        end;
      end;
      keep ENROLID event_date AGE SEX SEQNUM source code;
    run;
    %rg_checkpoint(reading &table);
    proc append base=work._rg_events data=work._rg_matching;
    run;
    %rg_checkpoint(appending events);
  %end;
%mend;

%macro roger_cut;
  %local n_rules rid domain sources mode days lower upper k table ds dt;
  %if %sysfunc(libref(&outlib)) ne 0 %then %do;
    %put ERROR: Assign output library &outlib before running ROGER.;
    %abort cancel;
  %end;
  /* Fail before writing any output from a previous run. */
  %if %sysfunc(exist(&outlib..cohort)) or %sysfunc(exist(&outlib..attrition)) or
      %sysfunc(exist(&outlib..definition)) or %sysfunc(exist(&outlib..rules)) or
      %sysfunc(exist(&outlib..code_sets)) %then %do;
    %put ERROR: ROGER output tables already exist. Use a fresh output library.;
    %abort cancel;
  %end;
  %do k=1 %to %sysfunc(countw(&outputs));
    %let table=%scan(&outputs,&k);
    %if %sysfunc(exist(&outlib..cut_&table)) %then %do;
      %put ERROR: ROGER output cut_&table already exists. Use a fresh output library.;
      %abort cancel;
    %end;
  %end;

  data work._rg_attrition;
    length step remaining 8 criterion $160;
    stop;
  run;
  proc sql noprint;
    select domain,sources into :domain trimmed,:sources trimmed
      from work._rg_rules where rule_id=1;
    select count(*) into :n_rules trimmed from work._rg_rules;
  quit;
  %rg_events(1,&domain,&sources);
  proc sort data=work._rg_events(where=(event_date >= &index_start and event_date <= &index_end))
    out=work._rg_index;
    by ENROLID event_date source SEQNUM;
  run;
  data work._rg_cohort;
    set work._rg_index;
    by ENROLID;
    if first.ENROLID;
    index_date=event_date;
    index_source=source;
    index_seqnum=SEQNUM;
    format index_date yymmdd10.;
    keep ENROLID index_date AGE SEX index_source index_seqnum;
  run;
  %rg_checkpoint(index event);
  %rg_count(1,First matching index event);
  data work._rg_cohort;
    set work._rg_cohort;
    if missing(AGE) or AGE < &age_min or AGE > &age_max then delete;
    %if &sex ne ALL %then %do;
      if SEX ne "&sex" then delete;
    %end;
  run;
  %rg_count(2,Demographic requirements);

  %if &enrollment=1 %then %do;
    %rg_require(&map_T,ENROLID DTSTART DTEND YEAR RX,N N N N C);
    proc sql;
      create table work._rg_intervals as
      select c.ENROLID,c.index_date,
             max(e.DTSTART,c.index_date-&baseline) as span_start,
             min(e.DTEND,c.index_date+&followup) as span_end
      from work._rg_cohort c inner join &map_T e
        on c.ENROLID=e.ENROLID
      where e.YEAR=2023 and not missing(e.DTSTART) and not missing(e.DTEND)
        and e.DTSTART <= e.DTEND
        and e.DTSTART <= c.index_date+&followup
        and e.DTEND >= c.index_date-&baseline
        %if &rx=1 %then %do; and e.RX='1' %end;
      order by ENROLID,span_start,span_end;
    quit;
    %rg_checkpoint(enrollment intervals);
    data work._rg_eligible;
      set work._rg_intervals;
      by ENROLID;
      retain covered_start covered_end max_gap;
      if first.ENROLID then do;
        covered_start=span_start;
        covered_end=span_end;
        max_gap=0;
      end;
      else do;
        max_gap=max(max_gap,span_start-covered_end-1);
        covered_end=max(covered_end,span_end);
      end;
      if last.ENROLID and covered_start <= index_date-&baseline
        and covered_end >= index_date+&followup and max_gap <= &gap then output;
      keep ENROLID;
    run;
    proc sql;
      create table work._rg_next as select c.* from work._rg_cohort c
      inner join work._rg_eligible e on c.ENROLID=e.ENROLID;
    quit;
    data work._rg_cohort; set work._rg_next; run;
    %rg_checkpoint(enrollment eligibility);
    %rg_count(3,Enrollment requirements);
  %end;

  %do rid=2 %to &n_rules;
    proc sql noprint;
      select domain,sources,mode,min_days,lower_day,upper_day
        into :domain trimmed,:sources trimmed,:mode trimmed,:days trimmed,:lower trimmed,:upper trimmed
        from work._rg_rules where rule_id=&rid;
    quit;
    %rg_events(&rid,&domain,&sources);
    proc sql;
      create table work._rg_hitcounts as
      select c.ENROLID,count(distinct e.event_date) as hit_days
      from work._rg_cohort c left join work._rg_events e
        on c.ENROLID=e.ENROLID and e.event_date >= c.index_date+&lower
        and e.event_date <= c.index_date+&upper
      group by c.ENROLID;
      create table work._rg_next as select c.* from work._rg_cohort c
      inner join work._rg_hitcounts h on c.ENROLID=h.ENROLID
      %if &mode=INCLUDE %then %do; where h.hit_days >= &days %end;
      %else %do; where h.hit_days < &days %end;
      ;
    quit;
    data work._rg_cohort; set work._rg_next; run;
    %rg_checkpoint(rule &rid);
    %rg_count(%eval(&rid+2),&mode rule &rid - &domain);
  %end;

  /* Prepare all extracts in WORK before creating the delivery datasets. */
  %do k=1 %to %sysfunc(countw(&outputs));
    %let table=%scan(&outputs,&k);
    %let ds=&&map_&table;
    %let dt=SVCDATE;
    %if &table=I %then %let dt=ADMDATE;
    %if &table=T %then %let dt=DTSTART;
    %rg_require(&ds,ENROLID &dt YEAR,N N N);
    %if &table=T %then %rg_require(&ds,DTEND,N);
    proc sql;
      create table work._rg_cut_&table as
      select e.*,c.index_date from &ds e inner join work._rg_cohort c
        on e.ENROLID=c.ENROLID
      where e.YEAR=2023 and not missing(e.&dt)
      %if &table=T %then %do;
        and not missing(e.DTEND) and e.DTSTART <= e.DTEND
        and e.DTSTART <= c.index_date+&extract_after
        and e.DTEND >= c.index_date-&extract_before
      %end;
      %else %do;
        and e.&dt >= c.index_date-&extract_before
        and e.&dt <= c.index_date+&extract_after
      %end;
      ;
    quit;
    %rg_checkpoint(extracting &table);
  %end;
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
  %do k=1 %to %sysfunc(countw(&outputs));
    %let table=%scan(&outputs,&k);
    data &outlib..cut_&table; set work._rg_cut_&table; run;
  %end;
  %rg_checkpoint(delivery);
  title 'ROGER cohort attrition';
  proc print data=&outlib..attrition noobs; run;
  title;
  %put NOTE: ROGER completed. Cohort and selected extracts are in &outlib..;
%mend;
