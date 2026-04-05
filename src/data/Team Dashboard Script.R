# -----------------------------------------#
# Team Dashboard Script (Optimized + Progress) #
# -----------------------------------------#

suppressPackageStartupMessages({
  library(dplyr)
  library(purrr)
  library(tidyr)
  library(readr)
  library(lubridate)
  library(stringr)
})

progress_apply <- function(items, fn, label = "Processing", on_error = c("warn", "stop")) {
  on_error <- match.arg(on_error)
  total <- length(items)
  if (total == 0) return(list())

  message(sprintf("%s (%d items)", label, total))
  pb <- txtProgressBar(min = 0, max = total, style = 3)
  on.exit(close(pb), add = TRUE)

  out <- vector("list", total)
  for (i in seq_along(items)) {
    item <- items[[i]]
    out[[i]] <- tryCatch(
      fn(item, i),
      error = function(e) {
        msg <- sprintf("%s failed for `%s`: %s", label, as.character(item), e$message)
        if (on_error == "stop") stop(msg, call. = FALSE)
        warning(msg, call. = FALSE)
        NULL
      }
    )
    setTxtProgressBar(pb, i)
  }
  out
}

bind_non_null <- function(x) bind_rows(purrr::compact(x))

normalize_01 <- function(x) {
  mn <- min(x, na.rm = TRUE)
  mx <- max(x, na.rm = TRUE)
  if (is.infinite(mn) || is.infinite(mx) || is.na(mn) || is.na(mx) || mx == mn) {
    return(rep(0, length(x)))
  }
  (x - mn) / (mx - mn)
}

fetch_by_season <- function(seasons, fetch_fn, label, source = "AFL") {
  season_rows <- progress_apply(
    seasons,
    function(season, ...) {
      fetch_fn(season = season, source = source) %>%
        mutate(season = season)
    },
    label = label
  )
  bind_non_null(season_rows)
}

exp_weighted_average <- function(values, dates, beta) {
  n <- length(values)
  out <- rep(NA_real_, n)
  if (n <= 1) return(out)

  date_num <- as.numeric(as.Date(dates))
  num <- 0
  den <- 0

  for (i in 2:n) {
    delta_days <- date_num[i] - date_num[i - 1]
    decay <- beta ^ delta_days
    num <- decay * (num + values[i - 1])
    den <- decay * (den + 1)
    out[i] <- if (den > 0) num / den else NA_real_
  }

  out
}

# -----------------------------------------#
# Team Playing Profiles
# -----------------------------------------#

fixture_seasons <- 2019:2026
fixtures <- progress_apply(
  fixture_seasons,
  function(season, ...) getFixture(season),
  label = "Fetching fixtures"
) %>%
  bind_non_null()

matchids <- fixtures %>%
  select(match.id, match.date) %>%
  mutate(season = year(match.date))

match_list <- fixtures %>%
  transmute(
    match.id = as.character(match.id),
    season.id,
    round.number,
    home.name,
    away.name,
    home.points,
    away.points,
    margin = home.points - away.points
  ) %>%
  filter(!is.na(margin))

squad_stats_raw <- progress_apply(
  match_list$match.id,
  function(match_id, ...) {
    ss <- getSquadStats(match_id)
    if (is.null(ss) || nrow(ss) == 0) return(NULL)

    tibble::as_tibble(ss) %>%
      mutate(
        across(
          any_of(c("code", "id", "name", "plural", "display", "squad.name", "squad.code")),
          as.character
        ),
        across(any_of(c("value")), as.numeric),
        match.id = as.character(match_id)
      )
  },
  label = "Fetching squad stats"
) %>%
  bind_non_null()

if (nrow(squad_stats_raw) == 0) {
  stop("No squad stats were returned for the selected matches.", call. = FALSE)
}

squad_stats_labeled <- squad_stats_raw %>%
  left_join(
    match_list %>% select(season.id, match.id, home.name, away.name),
    by = "match.id"
  ) %>%
  mutate(
    team_type = case_when(
      squad.name == home.name ~ "home",
      squad.name == away.name ~ "away",
      TRUE ~ NA_character_
    )
  ) %>%
  filter(!is.na(team_type))

team_stats <- squad_stats_labeled %>%
  group_by(season.id, squad.name) %>%
  summarise(
    KH_Ratio = mean(value[plural == "Kick to Handball Ratio"], na.rm = TRUE),
    GB_MK_Ratio = mean(value[plural == "Marks"], na.rm = TRUE) /
      mean(value[plural == "Groundball Gets"], na.rm = TRUE),
    Fwd_Half = mean(value[plural == "Time in Forward Half"], na.rm = TRUE),
    Scores = mean(value[plural == "Points"], na.rm = TRUE),
    PPchain = mean(value[plural == "Clearances"], na.rm = TRUE),
    Points_per_I50 = mean(value[plural == "Points per Inside 50"], na.rm = TRUE),
    Repeat_I50s = mean(value[plural == "Repeat Inside 50s"], na.rm = TRUE),
    Rating_Ball_Use = mean(value[plural == "Player Rating from Ball Use"], na.rm = TRUE),
    Rating_Ball_Win = mean(value[plural == "Player Rating from Ball Winning"], na.rm = TRUE),
    Chain_Metres = mean(value[plural == "Chain Metres"], na.rm = TRUE),
    Time_in_Poss_Pct = mean(value[plural == "Time in Possession Percentage"], na.rm = TRUE),
    .groups = "drop"
  )

exclude_numeric <- c("season.id", "providerId")

team_skill_radar <- team_stats %>%
  mutate(season = as.character(season.id)) %>%
  mutate(
    across(
      .cols = where(is.numeric) & !any_of(exclude_numeric),
      .fns = normalize_01
    )
  )

write_csv(team_skill_radar, "team_skill_radar.csv")

# -----------------------------------------#
# List Age + Experience & Trend over time
# -----------------------------------------#

team_kpis <- list_data %>%
  mutate(
    # Parse numerics defensively: DraftGuru formatting can vary by season/site.
    Age = readr::parse_number(Average.Age),
    Games = readr::parse_number(Average.Games),
    season = readr::parse_number(Year),
    New.Players = readr::parse_number(New.Players)
  ) %>%
  group_by(Club) %>%
  arrange(Club, season, .by_group = TRUE) %>%
  mutate(
    squad_age_yoy = round(Age - lag(Age), 2),
    squad_experience_yoy = round(Games - lag(Games), 2),
    squad_turnover_yoy = round(New.Players - lag(New.Players, 2))
  ) %>%
  select(
    Club,
    season,
    squad_age_avg = Age,
    squad_age_yoy,
    squad_experience_avg_games = Games,
    squad_experience_yoy,
    squad_turnover_players = New.Players,
    squad_turnover_yoy
  )

write_csv(team_kpis, "team_kpis.csv")

# -----------------------------------------#
# Ladder Position and trend across time
# -----------------------------------------#

team_rank_timeseries <- weighted_mean_predictions %>%
  select(
    Club = SourceTeam,
    year = SourceSeason,
    actual_rank = rank,
    forecast_a_rank = expected_finish_1,
    forecast_b_rank = expected_finish_2,
    finish_1_p10:finish_2_p90
  ) %>%
  filter(year >= 2012)

write_csv(team_rank_timeseries, "team_rank_timeseries.csv")

# -----------------------------------------#
# roster_players
# -----------------------------------------#

player_seasons <- 2012:2026

player_stats_afl <- fetch_by_season(
  seasons = player_seasons,
  fetch_fn = fetch_player_stats,
  label = "Fetching AFL player stats"
)

player_details_afl <- fetch_by_season(
  seasons = player_seasons,
  fetch_fn = fetch_player_details,
  label = "Fetching AFL player details"
)

roster_players <- player_details_afl %>%
  left_join(
    player_stats_afl,
    by = c("season", "providerId" = "player.player.player.playerId")
  ) %>%
  group_by(providerId) %>%
  fill(position, .direction = "downup") %>%
  ungroup() %>%
  mutate(
    player_name = paste(firstName, surname),
    age = season - as.numeric(str_sub(dateOfBirth, 1, 4))
  ) %>%
  group_by(season, team, providerId, player_name, age, position_group = position) %>%
  summarise(
    games = n(),
    ratings = sum(ratingPoints, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(
    age_cat = case_when(
      between(age, 18, 21) ~ "Rising Stars",
      between(age, 22, 25) ~ "Established Youth",
      between(age, 26, 29) ~ "Prime",
      between(age, 30, 33) ~ "Veterans",
      TRUE ~ "Old Timers"
    ),
    providerId = str_sub(providerId, 5)
  )

write_csv(roster_players, "roster_players.csv")

# -----------------------------------------#
# player acquisition breakdown
# -----------------------------------------#
get_afl_list_data <- function(seasons) {
  
  library(rvest)
  library(dplyr)
  library(purrr)
  library(stringr)
  
  # -------------------------------
  # AFL Clubs (URL-safe versions)
  # -------------------------------
  clubs <- c(
    "Adelaide", "Brisbane", "Carlton", "Collingwood", "Essendon",
    "Fremantle", "Geelong", "Gold-coast", "greater-western-sydney",
    "Hawthorn", "Melbourne", "North-Melbourne", "Port-Adelaide",
    "Richmond", "St-Kilda", "Sydney", "West-Coast", "Western-Bulldogs"
  )
  
  # -------------------------------
  # Internal scraper
  # -------------------------------
  scrape_list_data <- function(year, club) {
    
    url <- paste0("https://www.draftguru.com.au/lists/", year, "/", club)
    message("Scraping: ", url)
    
    page <- tryCatch(read_html(url), error = function(e) NULL)
    if (is.null(page)) return(NULL)
    
    tables <- page %>% html_nodes("table") %>% html_table(fill = TRUE)
    if (length(tables) == 0) return(NULL)
    
    cleaned <- map(tables, function(tbl) {
      
      # Fix missing column names
      if (any(is.na(names(tbl))) || any(names(tbl) == "")) {
        names(tbl) <- ifelse(
          names(tbl) == "" | is.na(names(tbl)),
          paste0("V", seq_along(tbl)),
          names(tbl)
        )
      }
      
      tbl <- tbl %>%
        mutate(across(everything(), as.character)) %>%
        mutate(
          Year = as.character(year),
          Club = club
        )
      
      names(tbl) <- make.names(names(tbl), unique = TRUE)
      tbl
    })
    
    bind_rows(cleaned, .id = "Table_Number")
  }
  
  # -------------------------------
  # Run across all seasons × clubs
  # -------------------------------
  params <- expand.grid(
    year = seasons,
    club = clubs,
    stringsAsFactors = FALSE
  )
  
  output <- pmap_dfr(params, scrape_list_data)
  
  return(output)
}

list_data <- get_afl_list_data(1994:2026)


# -------------------------------
# 🧹 Clean & Standardize Club Names
# -------------------------------
list_data_per <- list_data %>%
  select(Year, Club, Player,GamesPrior, Grade, Height, Weight, Age, Drafted) %>%
  mutate(
    Club = case_when(
      Club %in% c("adelaide") ~ "Adelaide",
      Club %in% c("brisbane", "fitzroy") ~ "Brisbane",
      Club %in% c("carlton") ~ "Carlton",
      Club %in% c("collingwood") ~ "Collingwood",
      Club %in% c("essendon") ~ "Essendon",
      Club %in% c("fremantle") ~ "Fremantle",
      Club %in% c("geelong") ~ "Geelong",
      Club %in% c("Gold-coast") ~ "Gold Coast",
      Club %in% c("greater-western-sydney") ~ "GWS",
      Club %in% c("hawthorn") ~ "Hawthorn",
      Club %in% c("melbourne") ~ "Melbourne",
      Club %in% c("North-Melbourne") ~ "North Melbourne",
      Club %in% c("Port-Adelaide") ~ "Port Adelaide",
      Club %in% c("richmond") ~ "Richmond",
      Club %in% c("St-Kilda") ~ "St Kilda",
      Club %in% c("sydney") ~ "Sydney",
      Club %in% c("West-Coast") ~ "West Coast",
      Club %in% c("Western-Bulldogs") ~ "Western Bulldogs",
      TRUE ~ Club
    )
  )

list_data_per %>% distinct(Club)
draft_data %>% distinct(Club)


# -------------------------------
# 🧠 Function: Scrape Draft Data (1991–2025)
# -------------------------------
scrape_draft_data <- function(year) {
  url <- paste0("https://www.draftguru.com.au/years/", year)
  message("Scraping draft year: ", year)
  
  page <- tryCatch(read_html(url), error = function(e) return(NULL))
  if (is.null(page)) return(NULL)
  
  tables <- page %>% html_nodes("table") %>% html_table(fill = TRUE)
  if (length(tables) == 0) return(NULL)
  
  # Clean and annotate
  tables_cleaned <- map(tables, function(tbl) {
    tbl <- mutate_all(tbl, as.character)
    tbl$Year <- as.character(year)
    return(tbl)
  })
  
  # Standardize and combine
  tables_cleaned <- map(tables_cleaned, ~ rename_with(.x, ~ make.names(.x, unique = TRUE)))
  bind_rows(tables_cleaned, .id = "Table_Number")
}

# Scrape all draft years
draft_data <- map_df(1991:2026, scrape_draft_data)

# -------------------------------
# 🔗 Join List & Draft Data
# -------------------------------
draft_data_refined <- inner_join(
  list_data_per,
  draft_data,
  by = c("Player", "Club")
) %>%
  distinct(
    Year = Year.x,
    Other_Year = Year.y,
    Club,
    Player,
    Draft,
    Pick = X...,
    Age.x,
    Age.y,
    Games,
    Goals,
    Height.x
  )


player_acquisition_breakdown <- list_data_per %>%
  left_join(draft_data_refined, by = c("Player", "Club", "Year" = "Year")) %>%
  filter(Year > Other_Year) %>%
  mutate(
    Age = Age.x,
    pick_num = suppressWarnings(as.numeric(Pick)),
    Draft = case_when(
      Draft %in% c("Pre-Season", "Rookie", "Post-Draft", "Training Squad Selection") ~ "Rookie/Post-Draft",
      Draft == "National" & pick_num <= 10 ~ "Top-10 National",
      Draft == "National" & pick_num <= 20 ~ "Top-20 National",
      Draft == "Mini-Draft" ~ "Top-10 National",
      TRUE ~ Draft
    )
  ) %>%
  group_by(Year, Club, Player, Height, Weight) %>%
  arrange(Year, Club, Player, Height, Weight, Other_Year, .by_group = TRUE) %>%
  slice(1) %>%
  ungroup() %>%
  filter(as.numeric(Year) >= 2012) %>%
  group_by(Club, Year, Draft) %>%
  summarise(value = n(), .groups = "drop")

write_csv(player_acquisition_breakdown, "player_acquisition_breakdown.csv")

player_acquisition_breakdown %>% summarise(max(Year))
test <- getSquadLists()

test %>% distinct(squad.id, squad.name)

# -----------------------------------------#
# career projection table
# -----------------------------------------#

player_projections <- combined_projections %>%
  filter(Season == 2027) %>%
  ungroup() %>%
  select(
    team = SourceClub,
    season = Season,
    salary,
    playerId = SourceproviderId,
    player_name = SourcePlayer,
    rating = estimate,
    AA,
    Games
  ) %>%
  mutate(season = 2026)

write_csv(player_projections, "player_projections.csv")

player_projections %>%
  group_by(team, season) %>%
  filter(!is.na(salary)) %>%
  summarise(salary = sum(salary), .groups = "drop")

# -----------------------------------------#
# Form Player
# -----------------------------------------#

beta1 <- 0.998
beta2 <- 0.985

form_player_afl <- player_stats_combined %>%
  filter(!is.na(ratingPoints), season >= 2012) %>%
  mutate(match_date = as.Date(utcStartTime)) %>%
  arrange(player.player.player.playerId, match_date) %>%
  group_by(player.player.player.playerId) %>%
  mutate(
    weighted_avg = exp_weighted_average(ratingPoints, match_date, beta1),
    recent_form = exp_weighted_average(ratingPoints, match_date, beta2),
    form_change = recent_form - weighted_avg
  ) %>%
  ungroup() %>%
  group_by(season, team.name) %>%
  arrange(season, team.name, desc(match_date), desc(form_change), .by_group = TRUE) %>%
  slice(1) %>%
  ungroup() %>%
  mutate(
    player_name = paste(firstName, surname),
    playerId = str_sub(player.player.player.playerId, 5),
    team = team.name
  ) %>%
  select(season, playerId, team, player_name, weighted_avg, recent_form, form_change)

normalize_token <- function(x) {
  x %>%
    tolower() %>%
    str_replace_all("[^a-z0-9]+", " ") %>%
    str_squish()
}

as_absolute_path <- function(path, root_dir) {
  if (is.na(path) || path == "") return(NA_character_)

  candidates <- c(
    path.expand(path),
    path,
    file.path(root_dir, basename(path)),
    file.path("/Users/jamesives/Library/Mobile Documents/com~apple~CloudDocs/Analytics Projects", path)
  )

  candidates <- unique(candidates[file.exists(candidates)])
  if (length(candidates) == 0) return(NA_character_)
  candidates[[1]]
}

equity_outputs_root <- "/Users/jamesives/Library/Mobile Documents/com~apple~CloudDocs/Analytics Projects/01 Projects/AFL Action Equity Model/Outputs"

equity_dir_candidates <- list.dirs(equity_outputs_root, recursive = FALSE, full.names = TRUE)
equity_dir_candidates <- equity_dir_candidates[
  basename(equity_dir_candidates) %in% c("league_equity_predictions_2019_to_current", "league_equity_predictions_2019_2025")
]

if (length(equity_dir_candidates) == 0) {
  stop(
    paste0(
      "No league equity prediction directory found in `", equity_outputs_root, "`.\n",
      "Run `score_remaining_leagues_with_equity_model.R` first."
    ),
    call. = FALSE
  )
}

equity_predictions_dir <- equity_dir_candidates[which.max(file.info(equity_dir_candidates)$mtime)]

equity_summary_candidates <- list.files(
  equity_predictions_dir,
  pattern = "^predicted_player_equity_scoring_summary_[0-9]{4}_to_[0-9]{4}\\.csv$",
  full.names = TRUE
)

if (length(equity_summary_candidates) == 0) {
  legacy_summary <- file.path(equity_predictions_dir, "predicted_player_equity_scoring_summary_2019_to_2025.csv")
  if (file.exists(legacy_summary)) {
    equity_summary_candidates <- legacy_summary
  }
}

if (length(equity_summary_candidates) == 0) {
  stop(
    paste0(
      "No equity scoring summary found in `", equity_predictions_dir, "`.\n",
      "Run `score_remaining_leagues_with_equity_model.R` first."
    ),
    call. = FALSE
  )
}

equity_summary_path <- equity_summary_candidates[which.max(file.info(equity_summary_candidates)$mtime)]

if (!file.exists(equity_summary_path)) {
  stop(
    paste0(
      "Equity scoring summary not found: ", equity_summary_path, "\n",
      "Run `score_remaining_leagues_with_equity_model.R` first."
    ),
    call. = FALSE
  )
}

equity_summary <- read_csv(equity_summary_path, show_col_types = FALSE)

selected_equity_files <- equity_summary %>%
  mutate(
    league_name_lc = tolower(league.name),
    level_name_lc = tolower(level.name),
    output_path = purrr::map_chr(output_file, as_absolute_path, root_dir = equity_predictions_dir),
    input_path = purrr::map_chr(input_file, as_absolute_path, root_dir = "/Users/jamesives")
  ) %>%
  filter(
    level_name_lc == "seniors",
    league_name_lc %in% c(
      "victorian football league",
      "south australian national football league",
      "west australian football league"
    ),
    !is.na(output_path),
    !is.na(input_path)
  ) %>%
  distinct(league.name, level.name, output_path, input_path, .keep_all = TRUE)

if (nrow(selected_equity_files) == 0) {
  stop(
    paste0(
      "No VFL/SANFL/WAFL senior equity outputs found in summary: ",
      equity_summary_path
    ),
    call. = FALSE
  )
}

league_rows <- progress_apply(
  seq_len(nrow(selected_equity_files)),
  function(i, ...) {
    output_path <- selected_equity_files$output_path[[i]]
    input_path <- selected_equity_files$input_path[[i]]

    pred <- read_csv(
      output_path,
      col_select = any_of(c("season.id", "match.id", "player.id", "player.name", "equity.rating.pred")),
      show_col_types = FALSE
    )

    required_pred_cols <- c("season.id", "match.id", "player.id", "player.name", "equity.rating.pred")
    missing_pred_cols <- setdiff(required_pred_cols, names(pred))
    if (length(missing_pred_cols) > 0) {
      stop(
        paste0(
          "Missing expected columns in predicted equity file: ",
          output_path,
          " | Missing: ",
          paste(missing_pred_cols, collapse = ", ")
        ),
        call. = FALSE
      )
    }

    team_lookup <- read_csv(
      input_path,
      col_select = any_of(c("match.id", "player.id", "squad.name")),
      show_col_types = FALSE
    ) %>%
      transmute(
        match.id = as.character(match.id),
        player.id = as.character(player.id),
        squad.name = as.character(squad.name)
      ) %>%
      distinct(match.id, player.id, .keep_all = TRUE)

    pred %>%
      transmute(
        season = suppressWarnings(as.integer(season.id)),
        match.id = as.character(match.id),
        player.id = as.character(player.id),
        player_name_source = as.character(player.name),
        rating_value = suppressWarnings(as.numeric(equity.rating.pred))
      ) %>%
      left_join(team_lookup, by = c("match.id", "player.id")) %>%
      mutate(source_league = selected_equity_files$league.name[[i]])
  },
  label = "Loading scored equity files (VFL/SANFL/WAFL)"
)

second_tier_stats <- bind_non_null(league_rows)

reserve_team_map <- c(
  # VFL
  "box hill" = "Hawthorn",
  "hawthorn" = "Hawthorn",
  "casey" = "Melbourne",
  "casey demons" = "Melbourne",
  "melbourne" = "Melbourne",
  "footscray" = "Western Bulldogs",
  "western bulldogs" = "Western Bulldogs",
  "sandringham" = "St Kilda",
  "st kilda" = "St Kilda",
  "geelong" = "Geelong Cats",
  "geelong cats" = "Geelong Cats",
  "brisbane" = "Brisbane Lions",
  "brisbane lions" = "Brisbane Lions",
  "sydney" = "Sydney Swans",
  "sydney swans" = "Sydney Swans",
  "greater western sydney" = "GWS GIANTS",
  "gws" = "GWS GIANTS",
  "gws giants" = "GWS GIANTS",
  "gold coast" = "Gold Coast SUNS",
  "gold coast suns" = "Gold Coast SUNS",
  "carlton" = "Carlton",
  "collingwood" = "Collingwood",
  "essendon" = "Essendon",
  "north melbourne" = "North Melbourne",
  "richmond" = "Richmond",
  # SANFL
  "adelaide" = "Adelaide Crows",
  "adelaide crows" = "Adelaide Crows",
  "port adelaide" = "Port Adelaide",
  "port adelaide magpies" = "Port Adelaide",
  "port adelaide reserves" = "Port Adelaide",
  # WAFL
  "west coast" = "West Coast Eagles",
  "west coast eagles" = "West Coast Eagles",
  "west coast eagles reserves" = "West Coast Eagles",
  "peel thunder" = "Fremantle",
  "fremantle" = "Fremantle"
)

form_player_vfl <- second_tier_stats %>%
  mutate(
    team_key = normalize_token(as.character(squad.name)),
    team = unname(reserve_team_map[team_key]),
    playerId_raw = as.character(player.id)
  ) %>%
  filter(
    !is.na(season),
    !is.na(team),
    !is.na(playerId_raw),
    playerId_raw != "",
    !is.na(player_name_source),
    player_name_source != "",
    !is.na(rating_value)
  ) %>%
  group_by(season, team, playerId_raw, player_name = player_name_source) %>%
  summarise(
    games = n(),
    rating_avg = mean(rating_value, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  mutate(min_games_required = if_else(season == max(season, na.rm = TRUE), 1L, 10L)) %>%
  filter(games >= min_games_required) %>%
  group_by(season, team) %>%
  arrange(desc(rating_avg), desc(games), .by_group = TRUE) %>%
  slice(1) %>%
  ungroup() %>%
  mutate(
    playerId = if_else(str_detect(playerId_raw, "^[A-Za-z]{2,4}"), str_sub(playerId_raw, 5), playerId_raw),
    weighted_avg = rating_avg
  ) %>%
  select(season, player_name, playerId, team, weighted_avg)

write_csv(form_player_vfl, "form_player_vfl.csv")
write_csv(form_player_afl, "form_player_afl.csv")
  
