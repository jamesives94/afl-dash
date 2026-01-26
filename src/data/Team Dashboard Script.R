
##---------------------#

# Team Playing Profiles

#----------------------#

# Get Fixtures
fixtures_2025 <- getFixture(2025)
fixtures_2024 <- getFixture(2024)
fixtures_2023 <- getFixture(2023)
fixtures_2022 <- getFixture(2022)
fixtures_2021 <- getFixture(2021)
fixtures_2020 <- getFixture(2020)
fixtures_2019 <- getFixture(2019)


fixtures <- rbind(fixtures_2025,fixtures_2024,fixtures_2023,fixtures_2022,fixtures_2021,fixtures_2020,fixtures_2019)

matchids <- fixtures %>% select(match.id,match.date) %>% mutate(season = year(match.date))


library(dplyr)
library(purrr)
library(tidyr)

# Get matches
match_list <- fixtures %>% 
  select(
    match.id,
    season.id,
    round.number,
    home.name,
    away.name,
    home.points,
    away.points
  ) %>% 
  mutate(
    margin = home.points - away.points
  ) %>% 
  filter(!is.na(margin))

#Map Squad Stats
squad_stats_raw <- map_dfr(
  match_list$match.id,
  ~ getSquadStats(.x) %>% mutate(match.id = .x),
  .id = NULL
)


squad_stats_labeled <- squad_stats_raw %>% 
  left_join(
    match_list %>% 
      select(season.id, match.id, home.name, away.name),
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
    
    GB_MK_Ratio =
      mean(value[plural == "Marks"], na.rm = TRUE) /
      mean(value[plural == "Groundball Gets"], na.rm = TRUE),
    
    Fwd_Half = mean(value[plural == "Time in Forward Half"], na.rm = TRUE),
    Scores   = mean(value[plural == "Points"], na.rm = TRUE),
    PPchain  = mean(value[plural == "Clearances"], na.rm = TRUE),
    
    Points_per_I50   = mean(value[plural == "Points per Inside 50"], na.rm = TRUE),
    Repeat_I50s      = mean(value[plural == "Repeat Inside 50s"], na.rm = TRUE),
    Rating_Ball_Use  = mean(value[plural == "Player Rating from Ball Use"], na.rm = TRUE),
    Rating_Ball_Win  = mean(value[plural == "Player Rating from Ball Winning"], na.rm = TRUE),
    Chain_Metres     = mean(value[plural == "Chain Metres"], na.rm = TRUE),
    Time_in_Poss_Pct = mean(value[plural == "Time in Possession Percentage"], na.rm = TRUE),
    .groups = "drop"
  )



team_skill_radar <- team_stats %>%
  group_by(squad.name) %>% mutate(season = as.character(season.id)) %>% 
  mutate(
    across(
      where(is.numeric),
      ~ ifelse(
        max(.x, na.rm = TRUE) == min(.x, na.rm = TRUE),
        0,
        (.x - min(.x, na.rm = TRUE)) /
          (max(.x, na.rm = TRUE) - min(.x, na.rm = TRUE))
      )
    )
  )

write_csv(
  team_skill_radar, 'team_skill_radar.csv')

#-----------------------------------------#
# List Age + Experience & Trend over time #
#-----------------------------------------#
team_kpis  <- list_data %>% mutate(Age = as.numeric(substr(Average.Age, 1,4)),
                     Games = as.numeric(substr(Average.Games, 1 ,4)),
                     season = as.numeric(Year),
                     New.Players = as.numeric(substr(New.Players, 2,3))) %>% 
  group_by(Club) %>% 
  arrange(Club, season) %>% 
  mutate(squad_age_yoy = round((Age - lag(Age)),2),
         squad_experience_yoy = round((Games - lag(Games)),2),
         squad_turnover_yoy = round((New.Players - lag(New.Players,2)))) %>% 
select(Club, season, squad_age_avg = Age, squad_age_yoy, squad_experience_avg_games = Games, squad_experience_yoy,
       squad_turnover_players = New.Players, squad_turnover_yoy)
       

write_csv(team_kpis , 'team_kpis.csv')


#-----------------------------------------#
#  Ladder Position and trend across time  #
#-----------------------------------------#

team_rank_timeseries <- weighted_mean_predictions %>% 
  select(Club = SourceTeam, year = SourceSeason, actual_rank = rank, forecast_a_rank = expected_finish_1, forecast_b_rank = expected_finish_2, 
         finish_1_p10:finish_2_p90) %>% filter(year >= 2012)

write_csv(team_rank_timeseries  , 'team_rank_timeseries.csv')

]
 
#-----------------------------------------#
#                 roster_players          #
#-----------------------------------------#


library(dplyr)
library(slider)

AFL_seasons <- list()

# loooooop
for (season in 2012:2025) {
  tryCatch({
    season_data <- fetch_player_stats(season = season, source = 'AFL')
    
    # add season
    season_data$season <- season
    
    # append
    AFL_seasons[[length(AFL_seasons) + 1]] <- season_data
  }, error = function(e) {
    message(paste("Failed to fetch data for season", season))
  })
}

# combine
player_stats_afl <- bind_rows(AFL_seasons)


AFL_seasons <- list()

# loooooop
for (season in 2012:2025) {
  tryCatch({
    season_data <- fetch_player_details(season = season, source = 'AFL')
    
    # add season
    season_data$season <- season
    
    # append
    AFL_seasons[[length(AFL_seasons) + 1]] <- season_data
  }, error = function(e) {
    message(paste("Failed to fetch data for season", season))
  })
}

# combine
player_details_afl <- bind_rows(AFL_seasons)

#combined both data sources
roster_players <- left_join( player_details_afl,player_stats_afl, by = c('season',  'providerId' = 'player.player.player.playerId' )) %>% 
  group_by(providerId) %>% 
  fill(position, .direction = "downup") %>% mutate(player_name = paste0(firstName, " ", surname),
                                                   age = season - as.numeric(substr(dateOfBirth, 1,4))) %>% 
  group_by(season, team, providerId, player_name, age, position_group = position) %>% 
  summarise(games = n()) 


write_csv( roster_players  , 'roster_players.csv')



#-----------------------------------------#
#   player acquisition breakdown          #
#-----------------------------------------#


player_acquisition_breakdown <- list_data_mod %>%
  left_join(draft_data_refined, by = c("Player", "Club", "Year" = "Year")) %>% 
  filter(Year > Other_Year) %>%
  mutate(
    Draft = ifelse(
      Draft %in% c("Pre-Season", "Rookie", "Post-Draft", "Training Squad Selection"),
      "Rookie/Post-Draft",
      Draft
    )
  ) %>% filter(!(Club %in% c('GWS', 'Gold Coast'))) %>% 
  mutate(Age = Age.x,
         Draft = ifelse(Draft == 'National' & as.numeric(Pick) <= 10, 'Top-10 National', 
                        ifelse(Draft == 'National' & as.numeric(Pick) <= 20, 'Top-20 National',
                               ifelse(Draft == 'Mini-Draft', 'Top-10 National',
                                      Draft)))) %>% 
  group_by(Year, Club, Player, Height, Weight) %>%
  arrange(Year, Club, Player, Height, Weight, (Other_Year)) %>% # change to DESC for latest selection
  dplyr::slice(1) %>% filter(as.numeric(Year) >= 2012) %>% 
  group_by(Club, Year, Draft) %>% 
  summarise(value = n()) 

write_csv(player_acquisition_breakdown, 'player_acquisition_breakdown.csv')

#-----------------------------------------#
#   career projection table.              #
#-----------------------------------------#

player_projections  <- combined_projections %>% filter(Season == 2026) %>% ungroup() %>% 
  select(team, season = Season, salary, playerId = SourceproviderId, player_name = SourcePlayer, rating = estimate, AA) %>% 
  mutate(season = 2025) 


write_csv(player_projections, 'player_projections.csv')



team_skill_radar
team_kpis
team_rank_timeseries 
roster_players 
player_acquisition_breakdown
player_projections

  