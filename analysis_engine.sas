/* ROGER SAS 9.4 analysis engine.
   RGIN is assigned ACCESS=READONLY. WORK holds intermediate data.
   RGANA is a newly created folder under the investigator's own home. */

%macro rg_analysis_preflight;
  %local dsid rc i var required type bad duplicates;
  %if not %sysfunc(exist(RGIN.&rg_dataset)) %then %do;
    %put ERROR: ROGER analysis input &rg_dataset is absent.; %abort cancel;
  %end;
  %let dsid=%sysfunc(open(RGIN.&rg_dataset,i));
  %if &dsid=0 %then %do;
    %put ERROR: Cannot open the analysis input read-only.; %abort cancel;
  %end;
  %let required=;
  %if &rg_method ne TABLE1 %then %let required=&rg_outcome;
  %if &rg_method ne ITS %then %let required=&required &rg_id &rg_treatment;
  %if &rg_method=MSM or &rg_method=CCW %then %let required=&required &rg_censor;
  %if &rg_method=MSM or &rg_method=CCW or &rg_method=DID or &rg_method=ITS or &rg_method=EVENT
    %then %let required=&required &rg_time;
  %if &rg_method=TABLE1 or &rg_method=PSM or &rg_method=IPTW or &rg_method=TTE
    %then %let required=&required Sex;
  %do i=1 %to %sysfunc(countw(&required));
    %let var=%scan(&required,&i);
    %let type=%sysfunc(varnum(&dsid,&var));
    %if &type=0 %then %do;
      %put ERROR: Required variable &var is absent from &rg_dataset.;
      %let rc=%sysfunc(close(&dsid)); %abort cancel;
    %end;
    %if &var ne &rg_id and &var ne Sex and %sysfunc(vartype(&dsid,&type)) ne N %then %do;
      %put ERROR: Required variable &var must be numeric.;
      %let rc=%sysfunc(close(&dsid)); %abort cancel;
    %end;
  %end;
  %if %length(%superq(rg_covariates))>0 %then %do;
    %do i=1 %to %sysfunc(countw(&rg_covariates));
      %let var=%scan(&rg_covariates,&i);
      %if &var ne sex_female %then %do;
        %let type=%sysfunc(varnum(&dsid,&var));
        %if &type=0 %then %do;
          %put ERROR: Predictor &var is absent from &rg_dataset.;
          %let rc=%sysfunc(close(&dsid)); %abort cancel;
        %end;
        %if %sysfunc(vartype(&dsid,&type)) ne N %then %do;
          %put ERROR: Predictor &var must be numeric. Encode categories before analysis.;
          %let rc=%sysfunc(close(&dsid)); %abort cancel;
        %end;
      %end;
    %end;
  %end;
  %let rc=%sysfunc(close(&dsid));
  data work.rg_source;
    set RGIN.&rg_dataset;
    %if &rg_method=TABLE1 or &rg_method=PSM or &rg_method=IPTW or &rg_method=TTE %then %do;
      if Sex in ('F','M') then sex_female=(Sex='F');
      else sex_female=.;
    %end;
  run;
  proc sql noprint;
    select count(*) into :rg_rows trimmed from work.rg_source;
  quit;
  %if &rg_rows=0 %then %do; %put ERROR: Analysis input is empty.; %abort cancel; %end;
  %if &rg_method ne ITS %then %do;
    proc sql noprint;
      select sum(missing(&rg_id)),sum(&rg_treatment not in (0,1))
        into :bad,:duplicates from work.rg_source;
    quit;
    %if &bad>0 or &duplicates>0 %then %do;
      %put ERROR: IDs must be present and treatment must be coded 0/1.; %abort cancel;
    %end;
  %end;
  %if &rg_method=MSM or &rg_method=CCW or &rg_method=DID or &rg_method=EVENT %then %do;
    proc sql noprint;
      select sum(n-1) into :duplicates trimmed
      from (select count(*) as n from work.rg_source group by &rg_id,&rg_time);
    quit;
    %if &duplicates>0 %then %do;
      %put ERROR: More than one panel row per person and period.; %abort cancel;
    %end;
  %end;
  %if &rg_method=TABLE1 or &rg_method=PSM or &rg_method=IPTW or &rg_method=TTE %then %do;
    proc sql noprint;
      select count(*)-count(distinct &rg_id) into :duplicates trimmed from work.rg_source;
    quit;
    %if &duplicates>0 %then %do;
      %put ERROR: Baseline analyses require one person per COHORT row.; %abort cancel;
    %end;
  %end;
%mend;

%macro rg_complete_baseline;
  data work.rg_baseline;
    set work.rg_source;
    if &rg_treatment in (0,1);
  run;
  data work.rg_model;
    set work.rg_baseline;
    %if &rg_method ne TABLE1 %then %do;
      if &rg_outcome not in (0,1) then delete;
    %end;
    if nmiss(of &rg_covariates)=0;
  run;
  proc sql noprint;
    select sum(&rg_treatment=1),sum(&rg_treatment=0)
      into :rg_treated_n trimmed,:rg_control_n trimmed from work.rg_model;
  quit;
  %if &rg_treated_n=0 or &rg_control_n=0 %then %do;
    %put ERROR: Both treatment arms need complete-case records.; %abort cancel;
  %end;
  title 'ROGER baseline analysis records and outcomes by treatment';
  proc freq data=work.rg_model;
    %if &rg_method=TABLE1 %then %do; tables &rg_treatment / missing; %end;
    %else %do; tables &rg_treatment*&rg_outcome / missing; %end;
  run;
  title;
%mend;

%macro rg_table1(data=,suffix=,weight=);
  data work.rg_t1_long;
    set &data;
    length variable $32;
    array predictors {*} &rg_covariates;
    do rg_j=1 to dim(predictors);
      variable=vname(predictors[rg_j]);
      value=predictors[rg_j];
      if not missing(value) then output;
    end;
    keep variable value &rg_treatment &weight;
  run;
  proc means data=work.rg_t1_long nway noprint;
    class variable &rg_treatment;
    var value;
    %if %length(&weight)>0 %then %do; weight &weight; %end;
    output out=work.rg_t1_cells n=n mean=mean std=sd;
  run;
  proc sql;
    create table RGANA.table1_&suffix as
    select t.variable,t.n as treated_n,c.n as control_n,
      t.mean as treated_mean,c.mean as control_mean,
      t.sd as treated_sd,c.sd as control_sd,
      case when t.sd*t.sd+c.sd*c.sd>0
        then (t.mean-c.mean)/sqrt((t.sd*t.sd+c.sd*c.sd)/2)
        else . end as smd
    from work.rg_t1_cells t inner join work.rg_t1_cells c
      on t.variable=c.variable and t.&rg_treatment=1 and c.&rg_treatment=0
    order by t.variable;
  quit;
  title "ROGER Table 1 &suffix: treated versus control";
  proc print data=RGANA.table1_&suffix noobs; run;
  title;
%mend;

%macro rg_psm;
  /* SAS/STAT PROC PSMATCH; 1:1 greedy, without replacement; ATT target. */
  proc psmatch data=work.rg_model region=allobs;
    class &rg_treatment;
    psmodel &rg_treatment(treated='1')=&rg_covariates;
    match method=greedy(k=1) distance=lps caliper=&rg_caliper;
    assess lps var=(&rg_covariates) / varinfo;
    output out(obs=match)=work.rg_psmatched matchid=rg_matchid ps=rg_ps;
  run;
  %if not %sysfunc(exist(work.rg_psmatched)) %then %do;
    %put ERROR: Matching did not produce data. Check SAS/STAT and propensity overlap.;
    %abort cancel;
  %end;
  data work.rg_adjusted;
    set work.rg_psmatched;
    rg_weight=1;
  run;
  data RGANA.matched; set work.rg_adjusted; run;
  proc freq data=work.rg_adjusted; tables &rg_treatment; run;
%mend;

%macro rg_iptw;
  /* Stabilized ATE weights; clipping and capping are explicit settings. */
  proc logistic data=work.rg_model descending;
    model &rg_treatment=&rg_covariates;
    output out=work.rg_scores p=rg_ps;
  run;
  proc sql noprint;
    select mean(&rg_treatment) into :rg_treated_fraction trimmed from work.rg_model;
  quit;
  data work.rg_adjusted;
    set work.rg_scores;
    if missing(rg_ps) then delete;
    rg_ps_clipped=max(&rg_ps_floor,min(1-&rg_ps_floor,rg_ps));
    if &rg_treatment=1 then rg_weight=&rg_treated_fraction/rg_ps_clipped;
    else rg_weight=(1-&rg_treated_fraction)/(1-rg_ps_clipped);
    rg_weight_raw=rg_weight;
    rg_weight=min(&rg_weight_cap,rg_weight);
  run;
  data RGANA.weighted; set work.rg_adjusted; run;
  title 'ROGER propensity and stabilized weight diagnostics';
  proc means data=work.rg_adjusted n min p1 p5 p25 median p75 p95 p99 max;
    class &rg_treatment;
    var rg_ps rg_weight_raw rg_weight;
  run;
  proc means data=work.rg_adjusted noprint;
    class &rg_treatment;
    var rg_ps rg_weight_raw rg_weight;
    output out=RGANA.weight_diagnostics n=n mean=mean min=min p1=p1 p5=p5
      median=median p95=p95 p99=p99 max=max / autoname;
  run;
  title;
%mend;

%macro rg_binary_model(data=,cluster=,weight=);
  /* Fixed-horizon binary outcome; independent-working GEE gives cluster SE. */
  ods output GEEEmpPEst=RGANA.model_estimates;
  proc genmod data=&data descending;
    class &cluster;
    model &rg_outcome=&rg_treatment / dist=binomial link=logit;
    %if %length(&weight)>0 %then %do; weight &weight; %end;
    repeated subject=&cluster / type=ind;
  run;
%mend;

%macro rg_tte;
  /* Point-treatment active-comparator emulation. Dynamic strategies need a panel. */
  data RGANA.trial_specification;
    length component $32 definition $250;
    component='Eligibility'; definition='Completed saved-cohort eligibility at time zero'; output;
    component='Strategies'; definition='Initiate treatment versus active comparator at index'; output;
    component='Assignment'; definition='Observed baseline treatment group; nonrandomized'; output;
    component='Time zero'; definition='index_date'; output;
    component='Follow-up'; definition="Day &rg_outcome_from through &rg_outcome_to"; output;
    component='Outcome'; definition="&rg_outcome: first event by day &rg_outcome_to"; output;
    component='Estimand'; definition='Stabilized ATE weighted fixed-horizon odds ratio'; output;
  run;
  %rg_iptw;
  %rg_table1(data=work.rg_adjusted,suffix=after,weight=rg_weight);
  %rg_binary_model(data=work.rg_adjusted,cluster=&rg_id,weight=rg_weight);
%mend;

%macro rg_panel_prepare;
  data work.rg_panel;
    set work.rg_source;
    if missing(&rg_time) or &rg_time<0 or &rg_time ne floor(&rg_time) then do;
      put 'ERROR: Panel periods must be nonnegative integers.'; abort cancel;
    end;
    %if &rg_method=MSM or &rg_method=CCW %then %do;
      if &rg_outcome not in (0,1) or &rg_censor not in (0,1) then do;
        put 'ERROR: Outcome and censor indicators must be 0/1.'; abort cancel;
      end;
      if &rg_outcome=1 and &rg_censor=1 then do;
        put 'ERROR: An outcome and observed censor cannot share an unresolved interval.';
        abort cancel;
      end;
      %if &rg_method=CCW %then %do;
        if &rg_outcome=1 and &rg_treatment=1 then do;
          put 'ERROR: An outcome and initiation cannot share an unresolved CCW interval.';
          abort cancel;
        end;
      %end;
      if nmiss(of &rg_covariates)>0 then do;
        put 'ERROR: Time-varying covariates must be complete or imputed before weighting.';
        abort cancel;
      end;
    %end;
  run;
  proc sort data=work.rg_panel; by &rg_id &rg_time; run;
  %if &rg_method=MSM or &rg_method=CCW %then %do;
    data work.rg_panel;
      set work.rg_panel;
      by &rg_id &rg_time;
      retain rg_previous_period;
      if first.&rg_id then do;
        if &rg_time ne 0 then do;
          put 'ERROR: Longitudinal periods must start at zero for every person.';
          abort cancel;
        end;
      end;
      else if &rg_time ne rg_previous_period+1 then do;
        put 'ERROR: Longitudinal periods must be contiguous until event or censor.';
        abort cancel;
      end;
      rg_previous_period=&rg_time;
      drop rg_previous_period;
    run;
  %end;
%mend;

%macro rg_panel_weights(clone=0);
  %if &clone=0 %then %do;
    /* Treatment numerator conditions on time and previous treatment;
       denominator additionally conditions on measured time-varying covariates. */
    proc logistic data=work.rg_panel_ready descending;
      model &rg_treatment=&rg_time rg_lag_treatment &rg_covariates;
      output out=work.rg_treat_den p=rg_treat_den;
    run;
    proc logistic data=work.rg_treat_den descending;
      model &rg_treatment=&rg_time rg_lag_treatment;
      output out=work.rg_treat_num p=rg_treat_num;
    run;
  %end;
  %else %do;
    /* Cloning assigns both strategies to every eligible person; only
       artificial and observed censoring weights are required. */
    data work.rg_treat_num;
      set work.rg_clones;
      rg_treat_num=0.5;
      rg_treat_den=0.5;
    run;
  %end;
  proc logistic data=work.rg_treat_num descending;
    model rg_stay=&rg_time %if &clone=1 %then strategy; %else &rg_treatment;
      &rg_covariates;
    output out=work.rg_censor_den p=rg_censor_den;
  run;
  proc logistic data=work.rg_censor_den descending;
    model rg_stay=&rg_time %if &clone=1 %then strategy; %else &rg_treatment;;
    output out=work.rg_censor_num p=rg_censor_num;
  run;
  proc sort data=work.rg_censor_num;
    by &rg_id %if &clone=1 %then strategy; &rg_time;
  run;
  data work.rg_weighted_panel;
    set work.rg_censor_num;
    by &rg_id %if &clone=1 %then strategy; &rg_time;
    retain rg_product rg_dropped;
    if first.%if &clone=1 %then strategy; %else &rg_id; then do;
      rg_product=1;
      rg_dropped=0;
    end;
    if rg_dropped then delete;
    if rg_stay=0 then do; rg_dropped=1; delete; end;
    rg_treat_den=max(&rg_ps_floor,min(1-&rg_ps_floor,rg_treat_den));
    rg_treat_num=max(&rg_ps_floor,min(1-&rg_ps_floor,rg_treat_num));
    rg_censor_den=max(&rg_ps_floor,min(1-&rg_ps_floor,rg_censor_den));
    rg_censor_num=max(&rg_ps_floor,min(1-&rg_ps_floor,rg_censor_num));
    %if &clone=0 %then %do;
      if &rg_treatment=1 then rg_factor=rg_treat_num/rg_treat_den;
      else rg_factor=(1-rg_treat_num)/(1-rg_treat_den);
    %end;
    %else %do; rg_factor=1; %end;
    rg_product=rg_product*rg_factor*rg_censor_num/rg_censor_den;
    rg_weight_raw=rg_product;
    rg_weight=min(&rg_weight_cap,rg_product);
  run;
  title 'ROGER longitudinal weight distribution';
  proc means data=work.rg_weighted_panel n min p1 p5 median p95 p99 max;
    var rg_weight_raw rg_weight;
  run;
  proc means data=work.rg_weighted_panel noprint;
    var rg_weight_raw rg_weight;
    output out=RGANA.weight_diagnostics n=n mean=mean min=min p1=p1 p5=p5
      median=median p95=p95 p99=p99 max=max / autoname;
  run;
  title;
%mend;

%macro rg_msm;
  %rg_panel_prepare;
  data work.rg_panel_ready;
    set work.rg_panel;
    by &rg_id &rg_time;
    retain rg_prior_event rg_prior_censor rg_lag_treatment;
    if first.&rg_id then do;
      rg_prior_event=0;rg_prior_censor=0;rg_lag_treatment=0;
    end;
    if rg_prior_event or rg_prior_censor then delete;
    rg_stay=1-&rg_censor;
    output;
    rg_prior_event=max(rg_prior_event,&rg_outcome);
    rg_prior_censor=max(rg_prior_censor,&rg_censor);
    rg_lag_treatment=&rg_treatment;
  run;
  %rg_panel_weights(clone=0);
  data RGANA.msm_panel; set work.rg_weighted_panel; run;
  /* Pooled-logistic marginal structural model; person-clustered SE. */
  ods output GEEEmpPEst=RGANA.model_estimates;
  proc genmod data=work.rg_weighted_panel descending;
    class &rg_id;
    model &rg_outcome=&rg_treatment &rg_time / dist=binomial link=logit;
    weight rg_weight;
    repeated subject=&rg_id / type=ind;
  run;
%mend;

%macro rg_ccw;
  %rg_panel_prepare;
  proc sql noprint;
    select sum(last_period<&rg_grace and events=0 and censors=0)
      into :rg_incomplete_grace trimmed
    from (select &rg_id,max(&rg_time) as last_period,
      sum(&rg_outcome) as events,sum(&rg_censor) as censors
      from work.rg_panel group by &rg_id);
  quit;
  %if &rg_incomplete_grace>0 %then %do;
    %put ERROR: CCW follow-up stops before the grace deadline without an event or censor.;
    %abort cancel;
  %end;
  /* Treatment is first initiation in each interval; 0 thereafter.
     Every person contributes both strategies at the same time zero. */
  data work.rg_history;
    set work.rg_panel;
    by &rg_id &rg_time;
    retain rg_initiated rg_prior_event rg_prior_censor;
    if first.&rg_id then do;
      rg_initiated=0;rg_prior_event=0;rg_prior_censor=0;
    end;
    if rg_prior_event or rg_prior_censor then delete;
    if rg_initiated=1 and &rg_treatment=1 then do;
      put 'ERROR: CCW initiation indicator repeats after first initiation.'; abort cancel;
    end;
    rg_initiated=max(rg_initiated,&rg_treatment);
    output;
    rg_prior_event=max(rg_prior_event,&rg_outcome);
    rg_prior_censor=max(rg_prior_censor,&rg_censor);
  run;
  data work.rg_clones;
    set work.rg_history;
    do strategy=0 to 1;
      rg_stay=1;
      if &rg_time<=&rg_grace and &rg_outcome=0 then do;
        if strategy=0 and rg_initiated=1 then rg_stay=0;
        if strategy=1 and &rg_time=&rg_grace and rg_initiated=0 then rg_stay=0;
      end;
      if &rg_censor=1 and &rg_outcome=0 then rg_stay=0;
      output;
    end;
  run;
  %rg_panel_weights(clone=1);
  data RGANA.ccw_panel; set work.rg_weighted_panel; run;
  title 'ROGER clone counts by strategy';
  proc freq data=work.rg_weighted_panel; tables strategy*rg_stay; run;
  title;
  ods output GEEEmpPEst=RGANA.model_estimates;
  proc genmod data=work.rg_weighted_panel descending;
    class &rg_id;
    model &rg_outcome=strategy &rg_time / dist=binomial link=logit;
    weight rg_weight;
    repeated subject=&rg_id / type=ind;
  run;
%mend;

%macro rg_did;
  %rg_panel_prepare;
  data work.rg_did;
    set work.rg_panel;
    if &rg_time not in (0,1) then do;
      put 'ERROR: Two-period DiD requires periods 0 and 1.'; abort cancel;
    end;
    if missing(&rg_outcome) then do;
      put 'ERROR: DiD outcome is missing.'; abort cancel;
    end;
    rg_interaction=&rg_treatment*&rg_time;
  run;
  proc sql;
    create table work.rg_did_people as
      select &rg_id,count(distinct &rg_time) as periods,
        min(&rg_treatment) as min_group,max(&rg_treatment) as max_group
      from work.rg_did group by &rg_id;
    select sum(periods ne 2 or min_group ne max_group)
      into :rg_bad_people trimmed from work.rg_did_people;
    select count(distinct &rg_treatment) into :rg_groups trimmed from work.rg_did;
  quit;
  %if &rg_bad_people>0 or &rg_groups ne 2 %then %do;
    %put ERROR: Each DiD person needs both periods and a fixed treatment group.;
    %abort cancel;
  %end;
  proc means data=work.rg_did nway noprint;
    class &rg_treatment &rg_time;
    var &rg_outcome;
    output out=RGANA.did_means n=n mean=mean std=sd;
  run;
  /* Interaction is the two-period DiD estimate under parallel trends. */
  ods output GEEEmpPEst=RGANA.model_estimates;
  proc genmod data=work.rg_did;
    class &rg_id;
    model &rg_outcome=&rg_treatment &rg_time rg_interaction / dist=normal link=identity;
    repeated subject=&rg_id / type=ind;
  run;
%mend;

%macro rg_its;
  /* One aggregated series, one row per integer period. Requires SAS/ETS. */
  data work.rg_its;
    set work.rg_source;
    if missing(&rg_time) or missing(&rg_outcome) then do;
      put 'ERROR: ITS periods and outcomes must be present.'; abort cancel;
    end;
    rg_post=(&rg_time>=&rg_intervention);
    rg_after=max(0,&rg_time-&rg_intervention);
  run;
  proc sql noprint;
    select sum(rg_post=0),sum(rg_post=1),count(*)-count(distinct &rg_time),
      max(&rg_time)-min(&rg_time)+1-count(*)
      into :rg_pre trimmed,:rg_post trimmed,:rg_duplicates trimmed,:rg_gaps trimmed
      from work.rg_its;
  quit;
  %if &rg_pre<8 or &rg_post<8 or &rg_duplicates>0 or &rg_gaps ne 0 %then %do;
    %put ERROR: ITS needs eight contiguous unique periods before and after intervention.;
    %abort cancel;
  %end;
  /* rg_post is immediate level change; rg_after is slope change. AR(1) errors. */
  ods output ParameterEstimates=RGANA.model_estimates;
  proc autoreg data=work.rg_its;
    model &rg_outcome=&rg_time rg_post rg_after / nlag=1;
    output out=RGANA.its_fit p=predicted r=residual;
  run;
%mend;

%macro rg_event;
  %local k;
  %rg_panel_prepare;
  proc sql;
    create table work.rg_event_people as
      select &rg_id,min(&rg_treatment) as min_group,max(&rg_treatment) as max_group,
        min(&rg_time) as first_period,max(&rg_time) as last_period,
        count(*) as periods,sum(missing(&rg_outcome)) as missing_outcomes
      from work.rg_panel group by &rg_id;
    select sum(min_group ne max_group) into :rg_bad_people trimmed from work.rg_event_people;
    select count(distinct &rg_treatment) into :rg_groups trimmed from work.rg_panel;
    select min(&rg_time),max(&rg_time),count(distinct &rg_time)
      into :rg_first_time trimmed,:rg_last_time trimmed,:rg_periods trimmed
      from work.rg_panel;
    select sum(first_period ne &rg_first_time or last_period ne &rg_last_time or
      periods ne &rg_periods or missing_outcomes>0)
      into :rg_unbalanced trimmed from work.rg_event_people;
  quit;
  %if &rg_bad_people>0 or &rg_groups ne 2 %then %do;
    %put ERROR: Single-wave event study requires a fixed treated/never-treated group.;
    %abort cancel;
  %end;
  %if &rg_unbalanced>0 or &rg_first_time>&rg_intervention-&rg_event_pre or
      &rg_last_time<&rg_intervention+&rg_event_post %then %do;
    %put ERROR: Event study needs complete balanced periods and the selected lead/lag window.;
    %abort cancel;
  %end;
  data work.rg_event;
    set work.rg_panel;
    if &rg_time<&rg_intervention-&rg_event_pre or
       &rg_time>&rg_intervention+&rg_event_post then delete;
    %do k=2 %to &rg_event_pre;
      rg_lead&k=(&rg_treatment=1 and &rg_time-&rg_intervention=-&k);
    %end;
    %do k=0 %to &rg_event_post;
      rg_lag&k=(&rg_treatment=1 and &rg_time-&rg_intervention=&k);
    %end;
  run;
  /* On a balanced panel, within-person centering removes person fixed effects.
     Calendar-period indicators then absorb common shocks; -1 is omitted. */
  proc means data=work.rg_event nway noprint;
    class &rg_id;
    var &rg_outcome
      %do k=2 %to &rg_event_pre; rg_lead&k %end;
      %do k=0 %to &rg_event_post; rg_lag&k %end;;
    output out=work.rg_event_means mean=rg_y_mean
      %do k=2 %to &rg_event_pre; rg_lead&k._mean %end;
      %do k=0 %to &rg_event_post; rg_lag&k._mean %end;;
  run;
  data work.rg_event_within;
    merge work.rg_event(in=rg_present) work.rg_event_means;
    by &rg_id;
    if rg_present;
    rg_y_within=&rg_outcome-rg_y_mean;
    %do k=2 %to &rg_event_pre;
      rg_lead&k._within=rg_lead&k-rg_lead&k._mean;
    %end;
    %do k=0 %to &rg_event_post;
      rg_lag&k._within=rg_lag&k-rg_lag&k._mean;
    %end;
  run;
  ods output GEEEmpPEst=RGANA.model_estimates;
  ods exclude ClassLevels;
  proc genmod data=work.rg_event_within;
    class &rg_id &rg_time;
    model rg_y_within=&rg_time
      %do k=2 %to &rg_event_pre; rg_lead&k._within %end;
      %do k=0 %to &rg_event_post; rg_lag&k._within %end;
      / dist=normal link=identity;
    repeated subject=&rg_id / type=ind;
  run;
  ods exclude none;
  data RGANA.event_design;
    set work.rg_event;
    keep &rg_id &rg_time &rg_treatment &rg_outcome
      %do k=2 %to &rg_event_pre; rg_lead&k %end;
      %do k=0 %to &rg_event_post; rg_lag&k %end;;
  run;
%mend;

%macro rg_analyze;
  %rg_analysis_preflight;
  data RGANA.analysis_specification;
    length method $8 input_dataset $32 id_variable $32 treatment_variable $32
      outcome_variable $32 time_variable $32 censor_variable $32 covariates $800;
    method="&rg_method";
    input_dataset="&rg_dataset";
    id_variable="&rg_id";
    treatment_variable="&rg_treatment";
    outcome_variable="&rg_outcome";
    time_variable="&rg_time";
    censor_variable="&rg_censor";
    covariates="&rg_covariates";
    ps_floor=&rg_ps_floor; weight_cap=&rg_weight_cap; caliper=&rg_caliper;
    grace_period=&rg_grace; intervention_period=&rg_intervention;
    output;
  run;
  %if &rg_method=TABLE1 or &rg_method=PSM or &rg_method=IPTW or &rg_method=TTE %then %do;
    %rg_complete_baseline;
    %if &rg_method=TABLE1 and &rg_adjustment=NONE %then %do;
      %rg_table1(data=work.rg_baseline,suffix=before);
    %end;
    %else %do;
      %rg_table1(data=work.rg_model,suffix=before);
    %end;
    %if &rg_method=TABLE1 %then %do;
      %if &rg_adjustment=PSM %then %do;
        %rg_psm; %rg_table1(data=work.rg_adjusted,suffix=after);
      %end;
      %if &rg_adjustment=IPTW %then %do;
        %rg_iptw; %rg_table1(data=work.rg_adjusted,suffix=after,weight=rg_weight);
      %end;
    %end;
    %if &rg_method=PSM %then %do;
      %rg_psm;
      %rg_table1(data=work.rg_adjusted,suffix=after);
      %rg_binary_model(data=work.rg_adjusted,cluster=rg_matchid);
    %end;
    %if &rg_method=IPTW %then %do;
      %rg_iptw;
      %rg_table1(data=work.rg_adjusted,suffix=after,weight=rg_weight);
      %rg_binary_model(data=work.rg_adjusted,cluster=&rg_id,weight=rg_weight);
    %end;
    %if &rg_method=TTE %then %rg_tte;
  %end;
  %else %if &rg_method=MSM %then %rg_msm;
  %else %if &rg_method=CCW %then %rg_ccw;
  %else %if &rg_method=DID %then %rg_did;
  %else %if &rg_method=ITS %then %rg_its;
  %else %if &rg_method=EVENT %then %rg_event;
  %else %do; %put ERROR: Unknown ROGER analysis method.; %abort cancel; %end;
  %put NOTE: ROGER analysis &rg_method completed. Outputs are in RGANA.;
%mend;
