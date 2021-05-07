/*
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * @fileoverview Helps prepare and define the BigQuery query configuration used
 * to fetch Four Keys Dashboard data.
 */
const DASHBOARD_QUERY = `WITH
  last_three_months AS (
    SELECT
      TIMESTAMP(day) AS day
    FROM
      UNNEST(
        GENERATE_DATE_ARRAY(
          DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH),
          CURRENT_DATE(),
          INTERVAL 1 DAY)) AS day
    # FROM the start of the data
    WHERE day > (SELECT date(min(time_created)) FROM four_keys.events_raw)
  )
SELECT
  FORMAT_TIMESTAMP('%Y%m%d', day) AS day,
  # Daily metrics
  deployments,
  change_fail_rate,
  median_time_to_resolve,
  median_time_to_change,

  # Buckets
  deployment_frequency,
  CASE
    WHEN max(median_time_to_change_bucket) OVER () < 24 THEN "One day"
    WHEN max(median_time_to_change_bucket) OVER () < 168 THEN "One week"
    WHEN max(median_time_to_change_bucket) OVER () < 730 THEN "One month"
    WHEN max(median_time_to_change_bucket) OVER () < 730 * 6 THEN "Six months"
    ELSE "One year"
    END AS lead_time_to_change,
  CASE
    WHEN sum(failures) OVER () / sum(deployments) OVER () <= .15 THEN "0-15%"
    WHEN sum(failures) OVER () / sum(deployments) OVER () < .46 THEN "16-45%"
    ELSE "46-60%"
    END AS change_fail_rate_bucket,
  CASE
    WHEN max(med_time_to_resolve_bucket) OVER () < 24 THEN "One day"
    WHEN max(med_time_to_resolve_bucket) OVER () < 168 THEN "One week"
    WHEN max(med_time_to_resolve_bucket) OVER () < 672 THEN "One month"
    WHEN max(med_time_to_resolve_bucket) OVER () < 730 * 6 THEN "Six months"
    WHEN max(med_time_to_resolve_bucket) OVER () > 730 * 6 THEN "One year"
    ELSE "null"
    END AS time_to_restore_buckets
FROM
  (
    SELECT
      e.day,
      IFNULL(COUNT(DISTINCT deploy_id), 0) AS deployments,
      IFNULL(sum(failure), 0) AS failures,
      IFNULL(sum(failure) / COUNT(DISTINCT deploy_id), 0) change_fail_rate,
      IFNULL(ANY_VALUE(med_time_to_resolve), 0) AS median_time_to_resolve,
      IFNULL(ANY_VALUE(med_time_to_change) / 60, 0) AS median_time_to_change,
      ANY_VALUE(med_time_to_change_bucket) / 60 AS median_time_to_change_bucket,
      ANY_VALUE(med_time_to_resolve_bucket) AS med_time_to_resolve_bucket
    FROM last_three_months e
    LEFT JOIN
      (
        SELECT
          d.deploy_id,
          TIMESTAMP_TRUNC(d.time_created, DAY) AS day,
          ##### Median Time to Change
          PERCENTILE_CONT(  # Ignore automated pushes
            IF(
              TIMESTAMP_DIFF(d.time_created, c.time_created, MINUTE) > 0,
              TIMESTAMP_DIFF(d.time_created, c.time_created, MINUTE),
              NULL),
            0.5)
            OVER (
              PARTITION BY TIMESTAMP_TRUNC(d.time_created, DAY)
            ) AS med_time_to_change,
          PERCENTILE_CONT(  # Ignore automated pushes
            IF(
              TIMESTAMP_DIFF(d.time_created, c.time_created, MINUTE) > 0,
              TIMESTAMP_DIFF(d.time_created, c.time_created, MINUTE),
              NULL),
            0.5)
            OVER () AS med_time_to_change_bucket,

          #### Change Fail Rate
          IF(i.incident_id IS NULL, 0, 1) AS failure,
          #### Median time to resolve
          PERCENTILE_CONT(
            TIMESTAMP_DIFF(time_resolved, d.time_created, HOUR), 0.5)
            OVER (
              PARTITION BY TIMESTAMP_TRUNC(d.time_created, DAY)
            ) AS med_time_to_resolve,
          PERCENTILE_CONT(
            TIMESTAMP_DIFF(time_resolved, d.time_created, HOUR), 0.5)
            OVER () AS med_time_to_resolve_bucket
        FROM four_keys.deployments d, d.changes
        LEFT JOIN four_keys.changes c
          ON changes = c.change_id
        LEFT JOIN
          (
            SELECT
              incident_id,
              change,
              time_resolved
            FROM
              four_keys.incidents i,
              i.changes change
          ) i
          ON i.change = changes
      ) d
      ON d.day = e.day
    GROUP BY day
  )
CROSS JOIN
  ##########################
  ### FREQUENCY BUCKET  ####
  (
    SELECT
      CASE
        WHEN daily THEN "Daily"
        WHEN weekly THEN "Weekly"
        # If at least one per month, then Monthly
        WHEN PERCENTILE_CONT(monthly_deploys, 0.5) OVER () >= 1 THEN "Monthly"
        ELSE "Yearly"
        END AS deployment_frequency
    FROM
      (
        SELECT
          # If the median number of days per week is more than 3, then Daily
          PERCENTILE_CONT(days_deployed, 0.5) OVER () >= 3 AS daily,
          # If most weeks have a deployment, then Weekly
          PERCENTILE_CONT(week_deployed, 0.5) OVER () >= 1 AS weekly,

          # Count the number of deployments per month.
          # Cannot mix aggregate and analytic functions, so calculate the median in the outer select statement
          SUM(week_deployed)
            OVER (PARTITION BY TIMESTAMP_TRUNC(week, MONTH)) monthly_deploys
        FROM
          (
            SELECT
              TIMESTAMP_TRUNC(last_three_months.day, WEEK) AS week,
              MAX(IF(deployments.day IS NOT NULL, 1, 0)) AS week_deployed,
              COUNT(DISTINCT deployments.day) AS days_deployed
            FROM last_three_months
            LEFT JOIN
              (
                SELECT
                  TIMESTAMP_TRUNC(time_created, DAY) AS day,
                  deploy_id
                FROM four_keys.deployments
              ) deployments
              ON deployments.day = last_three_months.day
            GROUP BY week
          )
      )
    LIMIT 1
  );`;


/**
 * Returns the BigQuery query configuration based on the data source
 * configuration.
 * @param {!Object} request The data request details including connector
 *     configuration.
 * @return {!Object<!BigQueryConfig>} The BigQuery query configuration for the
 *     given connector configuration.
 */
function getBqQueryConfig(request) {
  const cc = DataStudioApp.createCommunityConnector();

  const queryConfig = cc.newBigQueryConfig()
                        .setBillingProjectId(request.configParams.projectId)
                        .setAccessToken(ScriptApp.getOAuthToken())
                        .setQuery(DASHBOARD_QUERY)
                        .setUseStandardSql(true)
                        .build();
  return queryConfig;
}


/**
 * Returns a date formatted to match BQ date sharded table suffixes.
 * Table suffixes for BQ date sharded tables is YYYYMMDD and Data Studio passes
 * date range values using a YYYY-MM-DD format.
 * @param {string} date The date to format.
 * @return {string} The date formatted to match the table suffix format for
 *     BigQuery date sharded tables.
 */
function formatDateParam(date) {
  return date.replace(/-/g, '');
}
