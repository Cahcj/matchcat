const API_ROOT = "https://api.ftcscout.org/rest/v1";
const TEAM_NUMBER = 7305;
const GAME_SEASONS = {
  2013: "2012-2013 Ring It Up!",
  2014: "2013-2014 Block Party!",
  2015: "2014-2015 Cascade Effect",
  2016: "2015-2016 FIRST RES-Q",
  2017: "2016-2017 Velocity Vortex",
  2018: "2017-2018 FIRST Relic Recovery",
  2019: "2018-2019 Rover Ruckus",
  2020: "2019-2020 SKYSTONE",
  2021: "2020-2021 Ultimate Goal",
  2022: "2021-2022 Freight Frenzy",
  2023: "2022-2023 POWERPLAY",
  2024: "2023-2024 CENTERSTAGE",
  2025: "2024-2025 INTO THE DEEP",
  2026: "2025-2026 DECODE",
  2027: "2026-2027 Game TBA",
};

const state = {
  team: TEAM_NUMBER,
  year: 2026,
  teamInfo: null,
  participation: [],
  details: new Map(),
  events: new Map(),
  eventTeamReports: new Map(),
  eventTeamInsights: new Map(),
  teamEventStats: new Map(),
  teamEventRanks: new Map(),
  teamNames: new Map(),
  teamSeasonEventCache: new Map(),
  eventFilter: "all",
  selectedTeam: null,
};

const els = {
  form: document.querySelector("#tracker-form"),
  yearInput: document.querySelector("#year-input"),
  eventFilter: document.querySelector("#event-filter"),
  status: document.querySelector("#status"),
  teamTitle: document.querySelector("#team-title"),
  teamName: document.querySelector("#team-name"),
  teamLocation: document.querySelector("#team-location"),
  clagueRating: document.querySelector("#clague-rating"),
  matchCount: document.querySelector("#match-count"),
  eventCount: document.querySelector("#event-count"),
  recordCount: document.querySelector("#record-count"),
  avgScore: document.querySelector("#avg-score"),
  latestMatch: document.querySelector("#latest-match"),
  latestEvent: document.querySelector("#latest-event"),
  upcomingCard: document.querySelector("#upcoming-card"),
  matchBody: document.querySelector("#match-body"),
  picksList: document.querySelector("#picks-list"),
  picksStatus: document.querySelector("#picks-status"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
  teamDetailPanel: document.querySelector("#team-detail-panel"),
  teamDetailTitle: document.querySelector("#team-detail-title"),
  teamDetailBody: document.querySelector("#team-detail-body"),
  teamDetailClose: document.querySelector("#team-detail-close"),
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  refreshSelectedYear();
});

els.yearInput.addEventListener("change", () => {
  refreshSelectedYear();
});

function refreshSelectedYear() {
  const nextYear = Number.parseInt(els.yearInput.value, 10);

  if (!Number.isFinite(nextYear)) {
    setStatus("Choose a valid game year.");
    return;
  }

  state.team = TEAM_NUMBER;
  state.year = nextYear;
  loadTracker();
}

els.eventFilter.addEventListener("change", () => {
  state.eventFilter = els.eventFilter.value;
  render();
});

els.teamDetailClose.addEventListener("click", () => {
  state.selectedTeam = null;
  renderTeamDetail();
});

els.sidebarToggle.addEventListener("click", () => {
  const isOpen = document.body.classList.toggle("sidebar-open");
  els.sidebarToggle.setAttribute("aria-expanded", String(isOpen));
  els.sidebarBackdrop.hidden = !isOpen;
});

els.sidebarBackdrop.addEventListener("click", closeSidebar);

document.querySelectorAll(".sidebar-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-link").forEach((item) => {
      item.classList.toggle("is-active", item === link);
    });
    closeSidebar();
  });
});

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  els.sidebarToggle.setAttribute("aria-expanded", "false");
  els.sidebarBackdrop.hidden = true;
}

document.addEventListener("click", (event) => {
  const teamButton = event.target.closest(".team-link");
  if (!teamButton) return;

  openTeamDetail(Number(teamButton.dataset.teamNumber), teamButton.dataset.eventKey);
});

loadTracker();

async function loadTracker() {
  setLoading();
  state.details = new Map();
  state.events = new Map();
  state.eventTeamReports = new Map();
  state.eventTeamInsights = new Map();
  state.teamEventStats = new Map();
  state.teamEventRanks = new Map();
  state.teamNames = new Map();
  state.teamSeasonEventCache = new Map();
  state.eventFilter = "all";
  state.selectedTeam = null;
  els.eventFilter.value = "all";

  try {
    const [teamInfo, seasonMatches] = await Promise.all([
      getJson(`${API_ROOT}/teams/${state.team}`),
      loadTeamMatchesForGameYear(state.year),
    ]);

    state.teamInfo = teamInfo;
    state.participation = seasonMatches;
    await loadEventDetails();
    state.participation = state.participation.filter((match) => isMatchInGameYear(match));
    state.eventTeamInsights = buildEventTeamInsights();
    state.teamEventStats = buildTeamEventStats();
    state.teamEventRanks = buildTeamEventRanks();
    await loadOpponentTeamNames();
    populateEventFilter();
    render();
    setStatus(`Updated from FTCScout for ${getSeasonLabel(state.year)}.`);
  } catch (error) {
    console.error(error);
    setStatus("FTCScout data could not load right now.");
    els.picksStatus.textContent = "No pick data loaded.";
    els.picksList.innerHTML = `<div class="empty">No pick data returned for this team and season.</div>`;
    els.matchBody.innerHTML = `<tr><td colspan="8" class="empty">No live data returned for this team and season.</td></tr>`;
  }
}

async function loadTeamMatchesForGameYear(year) {
  const season = ftcScoutSeasonForGameYear(year);
  const responses = await Promise.allSettled([
    getJson(`${API_ROOT}/teams/${state.team}/matches?season=${season}`),
  ]);

  return responses.flatMap((response) =>
    response.status === "fulfilled" ? normalizeCollection(response.value) : [],
  );
}

async function loadEventDetails() {
  const eventKeys = [...new Set(
    state.participation.map((match) => `${match.season}:${match.eventCode}`),
  )];
  const requests = eventKeys.map(async (eventKey) => {
    const [season, eventCode] = eventKey.split(":");
    try {
      const [matchesResponse, eventInfoResponse, eventTeamsResponse] = await Promise.allSettled([
        getJson(`${API_ROOT}/events/${season}/${eventCode}/matches`),
        getJson(`${API_ROOT}/events/${season}/${eventCode}`),
        getJson(`${API_ROOT}/events/${season}/${eventCode}/teams`),
      ]);

      if (eventInfoResponse.status === "fulfilled") {
        state.events.set(`${season}:${eventCode}`, eventInfoResponse.value);
      }

      if (eventTeamsResponse.status === "fulfilled") {
        state.eventTeamReports.set(`${season}:${eventCode}`, normalizeCollection(eventTeamsResponse.value));
      }

      const matches = matchesResponse.status === "fulfilled"
        ? normalizeCollection(matchesResponse.value)
        : [];
      matches.forEach((match) => {
        state.details.set(`${match.eventSeason}:${eventCode}:${match.id}`, match);
      });
    } catch (error) {
      console.warn(`Could not load details for ${eventCode}`, error);
    }
  });

  await Promise.allSettled(requests);
}

async function loadOpponentTeamNames() {
  const teamNumbers = new Set();

  state.participation.forEach((entry) => {
    const detail = state.details.get(`${entry.season}:${entry.eventCode}:${entry.matchId}`);
    (detail?.teams ?? [])
      .filter((team) => team.teamNumber !== state.team)
      .forEach((team) => teamNumbers.add(team.teamNumber));
  });

  const requests = [...teamNumbers].map(async (teamNumber) => {
    try {
      const team = await getJson(`${API_ROOT}/teams/${teamNumber}`);
      state.teamNames.set(teamNumber, team?.name ?? `Team ${teamNumber}`);
    } catch (error) {
      console.warn(`Could not load team ${teamNumber}`, error);
      state.teamNames.set(teamNumber, `Team ${teamNumber}`);
    }
  });

  await Promise.allSettled(requests);
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function normalizeCollection(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.value)) return response.value;
  return [];
}

function populateEventFilter() {
  const events = [...new Map(
    state.participation.map((match) => {
      const key = eventKey(match);
      return [key, { key, name: eventName(match), code: match.eventCode }];
    }),
  ).values()].sort((a, b) => a.name.localeCompare(b.name));

  els.eventFilter.innerHTML = `<option value="all">All competitions</option>`;
  events.forEach((event) => {
    const option = document.createElement("option");
    option.value = event.key;
    option.textContent = event.name;
    els.eventFilter.append(option);
  });
}

function render() {
  const rows = getRows();
  const visibleRows =
    state.eventFilter === "all"
      ? rows
      : rows.filter((row) => row.eventKey === state.eventFilter);
  const upcomingMatch = getUpcomingMatch(rows);
  const pastRows = visibleRows.filter((row) => !isUpcoming(row));

  renderSummary(rows, rows);
  renderClagueRating(visibleRows);
  renderUpcomingMatch(upcomingMatch);
  renderTeamDetail();
  renderPicks(visibleRows);
  renderMatches(pastRows);
}

function getRows() {
  return state.participation
    .map((entry) => {
      const detail = state.details.get(`${entry.season}:${entry.eventCode}:${entry.matchId}`);
      const teams = detail?.teams ?? [];
      const myAlliance = entry.alliance?.toLowerCase();
      const redScore = detail?.scores?.red?.totalPoints;
      const blueScore = detail?.scores?.blue?.totalPoints;
      const myScore = myAlliance === "red" ? redScore : blueScore;
      const oppScore = myAlliance === "red" ? blueScore : redScore;
      const allianceTeams = teams
        .filter((team) => team.alliance === entry.alliance)
        .map((team) => team.teamNumber);
      const opponentTeams = teams
        .filter((team) => team.alliance !== entry.alliance)
        .map((team) => team.teamNumber);
      const partners = allianceTeams
        .filter((teamNumber) => teamNumber !== state.team)
        .map((teamNumber) => getTeamRating(teamNumber, entry));
      const opponents = opponentTeams.map((teamNumber) => getTeamRating(teamNumber, entry));
      const redTeams = teams
        .filter((team) => team.alliance === "Red")
        .map((team) => getTeamRating(team.teamNumber, entry));
      const blueTeams = teams
        .filter((team) => team.alliance === "Blue")
        .map((team) => getTeamRating(team.teamNumber, entry));

      return {
        ...entry,
        detail,
        eventKey: eventKey(entry),
        eventName: eventName(entry),
        partners,
        opponents,
        redTeams,
        blueTeams,
        redScore,
        blueScore,
        myScore,
        oppScore,
        result: getResult(myScore, oppScore),
        scheduledStartTime: detail?.scheduledStartTime ?? entry.createdAt,
        tournamentLevel: detail?.tournamentLevel ?? matchType(entry.matchId),
        hasBeenPlayed: detail?.hasBeenPlayed ?? null,
      };
    })
    .sort((a, b) => {
      const eventSort = String(a.eventName).localeCompare(String(b.eventName));
      return eventSort || Number(a.matchId) - Number(b.matchId);
    });
}

function renderSummary(allRows, visibleRows) {
  const team = state.teamInfo;
  const eventCodes = new Set(allRows.map((row) => row.eventKey));
  const played = allRows.filter((row) => row.result !== "Pending" && row.result !== "No score");
  const wins = played.filter((row) => row.result === "Win").length;
  const losses = played.filter((row) => row.result === "Loss").length;
  const ties = played.filter((row) => row.result === "Tie").length;
  const scored = allRows.filter((row) => Number.isFinite(row.myScore));
  const average = scored.length
    ? Math.round(scored.reduce((sum, row) => sum + row.myScore, 0) / scored.length)
    : "--";
  const latest = [...allRows]
    .filter((row) => row.scheduledStartTime)
    .sort((a, b) => new Date(b.scheduledStartTime) - new Date(a.scheduledStartTime))[0];

  els.teamTitle.textContent = `Team ${state.team}`;
  els.teamName.textContent = team?.name ?? `Team ${state.team}`;
  els.teamLocation.textContent = [team?.city, team?.state, team?.country]
    .filter(Boolean)
    .join(", ") || "FTC team profile";
  els.matchCount.textContent = String(visibleRows.length);
  els.eventCount.textContent = `Across ${eventCodes.size || "--"} events`;
  els.recordCount.textContent = played.length ? `${wins}-${losses}-${ties}` : "--";
  els.avgScore.textContent = `Avg alliance score ${average}`;
  els.latestMatch.textContent = latest ? formatMatchName(latest) : "--";
  els.latestEvent.textContent = latest ? `${latest.eventName} / ${formatDate(latest.scheduledStartTime)}` : "Waiting for data";
}

function renderClagueRating(rows) {
  const rating = getClagueRating(rows);
  const record = rating.record;
  const title = state.eventFilter === "all"
    ? `${getSeasonLabel(state.year)} overall`
    : eventDisplayName(state.eventFilter);
  const stars = record.played ? rating.stars : 0;
  const rate = record.played ? `${Math.round(record.winRate * 100)}% win rate` : "No played matches";
  const starText = starRating(stars) || "0 stars";

  els.clagueRating.innerHTML = `
    <span>Clague rating</span>
    <strong class="clague-rating__stars" aria-label="${stars} out of 5 stars">${starText}</strong>
    <small>${escapeHtml(title)} / ${record.played ? `${record.wins}-${record.losses}-${record.ties}` : "0-0-0"} / ${rate} / ${escapeHtml(rating.source)}</small>
  `;
}

function getClagueRating(rows) {
  const record = getTeamRecord(rows);
  const eventKeys = [...new Set(rows.map((row) => row.eventKey))];

  if (state.eventFilter !== "all") {
    const eventStats = state.teamEventStats.get(teamStatsKey(state.eventFilter, state.team));
    const ratingScore = Number.isFinite(eventStats?.ratingScore)
      ? eventStats.ratingScore
      : record.winRate;

    return {
      record,
      stars: Math.round(ratingScore * 5),
      source: eventStats?.ratingSource ?? "Match record",
    };
  }

  const eventRatings = eventKeys
    .map((key) => state.teamEventStats.get(teamStatsKey(key, state.team)))
    .filter((stats) => Number.isFinite(stats?.ratingScore) && stats.played);
  const totalPlayed = eventRatings.reduce((sum, stats) => sum + stats.played, 0);
  const ratingScore = totalPlayed
    ? eventRatings.reduce((sum, stats) => sum + stats.ratingScore * stats.played, 0) / totalPlayed
    : record.winRate;

  return {
    record,
    stars: Math.round(ratingScore * 5),
    source: eventRatings.length
      ? "FTCScout OPR + event rankings + teammate-adjusted wins"
      : "Match record",
  };
}

function getTeamRecord(rows) {
  const played = rows.filter((row) => row.result === "Win" || row.result === "Loss" || row.result === "Tie");
  const wins = played.filter((row) => row.result === "Win").length;
  const losses = played.filter((row) => row.result === "Loss").length;
  const ties = played.filter((row) => row.result === "Tie").length;
  const winRate = played.length ? (wins + ties * 0.5) / played.length : 0;

  return { wins, losses, ties, played: played.length, winRate };
}

function renderMatches(rows) {
  if (!rows.length) {
    els.matchBody.innerHTML = `<tr><td colspan="8" class="empty">No matches found for this filter.</td></tr>`;
    return;
  }

  els.matchBody.innerHTML = rows.map((row) => {
    const allianceClass = row.alliance === "Red" ? "pill--red" : "pill--blue";

    return `
      <tr>
        <td data-label="Match">
          <div class="match-title match-title--desktop">
            <strong>${formatMatchName(row)}</strong>
            <span>${row.tournamentLevel}</span>
          </div>
          ${formatMobileMatchCard(row)}
        </td>
        <td data-label="Competition">${escapeHtml(row.eventName)}</td>
        <td data-label="Alliance"><span class="pill ${allianceClass}">${row.alliance} ${row.station}</span></td>
        <td data-label="Teammates">${formatTeamRatings(row.partners)}</td>
        <td data-label="Opponents">${formatTeamRatings(row.opponents)}</td>
        <td data-label="Score">${formatScore(row)}</td>
        <td data-label="Result" class="${resultClass(row.result)}">${row.result}</td>
        <td data-label="Time">${formatDate(row.scheduledStartTime)}</td>
      </tr>
    `;
  }).join("");
}

function renderUpcomingMatch(nextMatch) {
  if (!nextMatch) {
    els.upcomingCard.innerHTML = `
      <div class="empty">No upcoming match is listed for this filter yet.</div>
    `;
    return;
  }

  const allianceClass = nextMatch.alliance === "Red" ? "pill--red" : "pill--blue";

  els.upcomingCard.innerHTML = `
    <article class="upcoming-match">
      <div class="upcoming-match__main">
        <span class="pill ${allianceClass}">${nextMatch.alliance} ${nextMatch.station}</span>
        <h3>${formatMatchName(nextMatch)}</h3>
        <p>${escapeHtml(nextMatch.eventName)} / ${nextMatch.tournamentLevel}</p>
      </div>
      <div class="upcoming-match__meta">
        <div>
          <span>Time</span>
          <strong>${formatDate(nextMatch.scheduledStartTime)}</strong>
        </div>
        <div>
          <span>Teammates</span>
          ${formatTeamRatings(nextMatch.partners)}
        </div>
      </div>
      <div class="upcoming-match__opponents">
        <span>Opponents</span>
        ${formatTeamRatings(nextMatch.opponents)}
      </div>
    </article>
  `;
}

function renderPicks(rows) {
  const picks = getPickCandidates(rows).slice(0, 12);
  const scope = state.eventFilter === "all"
    ? getSeasonLabel(state.year)
    : eventDisplayName(state.eventFilter);

  els.picksStatus.textContent = picks.length
    ? `Best options for ${scope}.`
    : `No pick data found for ${scope}.`;

  if (!picks.length) {
    els.picksList.innerHTML = `<div class="empty">No ranked pick options found yet.</div>`;
    return;
  }

  els.picksList.innerHTML = picks.map((pick, index) => `
    <article class="pick-card">
      <div class="pick-card__rank">#${index + 1}</div>
      <div class="pick-card__main">
        <button class="team-link pick-card__team" type="button" data-team-number="${pick.teamNumber}" data-event-key="${escapeHtml(pick.eventKey)}">
          <span>${pick.teamNumber}</span>
          ${escapeHtml(pick.name)}
        </button>
        <div class="pick-card__meta">${escapeHtml(pick.eventName)} / ${pick.record} / ${pick.winRate}% win rate</div>
        <div class="stars" aria-label="${pick.stars} out of 5 stars">${starRating(pick.stars)}</div>
      </div>
      <div class="pick-card__stats">
        <span>Rank <strong>${Number.isFinite(pick.rank) ? pick.rank : "--"}</strong></span>
        <span>OPR <strong>${Number.isFinite(pick.opr) ? pick.opr.toFixed(1) : "--"}</strong></span>
        <span>Score <strong>${Math.round(pick.pickScore * 100)}</strong></span>
      </div>
    </article>
  `).join("");
}

function getPickCandidates(rows) {
  const visibleEventKeys = new Set(rows.map((row) => row.eventKey));
  const bestByTeam = new Map();

  state.teamEventStats.forEach((stats) => {
    if (stats.teamNumber === TEAM_NUMBER || !stats.played) return;
    if (visibleEventKeys.size && !visibleEventKeys.has(stats.eventKey)) return;

    const rank = state.teamEventRanks.get(teamStatsKey(stats.eventKey, stats.teamNumber));
    const rankScore = Number.isFinite(rank) ? 1 / Math.max(rank, 1) : 0;
    const oprScore = Number.isFinite(stats.opr) ? Math.min(1, Math.max(0, stats.opr / 120)) : 0;
    const ratingScore = Number.isFinite(stats.ratingScore) ? stats.ratingScore : stats.winRate;
    const pickScore = weightedRatingScore([
      { value: ratingScore, weight: 0.5 },
      { value: oprScore, weight: 0.28 },
      { value: stats.winRate, weight: 0.14 },
      { value: rankScore, weight: 0.08 },
    ]);
    const current = {
      teamNumber: stats.teamNumber,
      name: state.teamNames.get(stats.teamNumber) ?? `Team ${stats.teamNumber}`,
      eventKey: stats.eventKey,
      eventName: eventDisplayName(stats.eventKey),
      rank,
      opr: stats.opr,
      stars: stats.stars ?? Math.round((pickScore ?? 0) * 5),
      record: `${stats.wins}-${stats.losses}-${stats.ties}`,
      winRate: Math.round(stats.winRate * 100),
      pickScore: pickScore ?? 0,
    };
    const previous = bestByTeam.get(stats.teamNumber);

    if (!previous || current.pickScore > previous.pickScore) {
      bestByTeam.set(stats.teamNumber, current);
    }
  });

  return [...bestByTeam.values()].sort((a, b) =>
    b.pickScore - a.pickScore ||
    (b.opr ?? 0) - (a.opr ?? 0) ||
    (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY) ||
    a.teamNumber - b.teamNumber,
  );
}

async function openTeamDetail(teamNumber, eventKeyForCard) {
  state.selectedTeam = {
    teamNumber,
    eventKey: eventKeyForCard,
    loading: true,
  };
  renderTeamDetail();
  els.teamDetailPanel.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    await loadTeamSeasonEvents(teamNumber);
  } catch (error) {
    console.warn(`Could not load season events for ${teamNumber}`, error);
  } finally {
    if (state.selectedTeam?.teamNumber === teamNumber) {
      state.selectedTeam.loading = false;
      renderTeamDetail();
    }
  }
}

async function loadTeamSeasonEvents(teamNumber) {
  const cacheKey = `${state.year}:${teamNumber}`;
  if (state.teamSeasonEventCache.has(cacheKey)) return;

  const season = ftcScoutSeasonForGameYear(state.year);
  const matches = normalizeCollection(
    await getJson(`${API_ROOT}/teams/${teamNumber}/matches?season=${season}`),
  );
  const eventKeys = [...new Set(matches.map((match) => `${match.season}:${match.eventCode}`))];
  const requests = eventKeys.map(async (key) => {
    const [eventSeason, eventCode] = key.split(":");
    const requestsForEvent = [];

    if (!state.events.has(key)) {
      requestsForEvent.push(
        getJson(`${API_ROOT}/events/${eventSeason}/${eventCode}`)
          .then((eventInfo) => state.events.set(key, eventInfo)),
      );
    }

    if (!state.eventTeamReports.has(key)) {
      requestsForEvent.push(
        getJson(`${API_ROOT}/events/${eventSeason}/${eventCode}/teams`)
          .then((reports) => state.eventTeamReports.set(key, normalizeCollection(reports))),
      );
    }

    requestsForEvent.push(
      getJson(`${API_ROOT}/events/${eventSeason}/${eventCode}/matches`)
        .then((matchesResponse) => {
          normalizeCollection(matchesResponse).forEach((match) => {
            state.details.set(`${match.eventSeason}:${eventCode}:${match.id}`, match);
          });
        }),
    );

    await Promise.allSettled(requestsForEvent);
  });

  await Promise.allSettled(requests);
  state.eventTeamInsights = buildEventTeamInsights();
  state.teamEventStats = buildTeamEventStats();
  state.teamEventRanks = buildTeamEventRanks();
  state.teamSeasonEventCache.set(cacheKey, true);
}

function renderTeamDetail() {
  if (!state.selectedTeam?.teamNumber) {
    els.teamDetailPanel.hidden = true;
    els.teamDetailBody.innerHTML = "";
    return;
  }

  const teamNumber = state.selectedTeam.teamNumber;
  const teamName = state.teamNames.get(teamNumber) ?? `Team ${teamNumber}`;
  const eventKeyForCard = getBestDetailEventKey(teamNumber, state.selectedTeam.eventKey);
  const insight = state.eventTeamInsights.get(teamStatsKey(eventKeyForCard, teamNumber));
  const stats = state.teamEventStats.get(teamStatsKey(eventKeyForCard, teamNumber));
  const rows = getTeamEventHistory(teamNumber);
  const detailStars = stats?.stars ?? insight?.stars ?? 0;
  const rankRows = rows.length
    ? rows.map((row) => `
        <tr>
          <td data-label="Competition">${escapeHtml(row.eventName)}</td>
          <td data-label="Rank">${Number.isFinite(row.rank) ? row.rank : "--"}</td>
          <td data-label="OPR">${Number.isFinite(row.opr) ? row.opr.toFixed(1) : "--"}</td>
          <td data-label="Auto OPR">${Number.isFinite(row.autoOpr) ? row.autoOpr.toFixed(1) : "--"}</td>
          <td data-label="Teleop OPR">${Number.isFinite(row.teleopOpr) ? row.teleopOpr.toFixed(1) : "--"}</td>
          <td data-label="Record">${row.record}</td>
          <td data-label="Stars"><span class="stars">${starRating(row.stars) || "0 stars"}</span></td>
        </tr>
      `).join("")
    : `<tr><td colspan="7" class="empty">No past competition ranking data found for this team.</td></tr>`;

  els.teamDetailPanel.hidden = false;
  els.teamDetailTitle.textContent = `${teamName} #${teamNumber}`;
  els.teamDetailBody.innerHTML = `
    ${state.selectedTeam.loading ? `<div class="team-detail__loading">Loading all ${getSeasonLabel(state.year)} competitions for this team...</div>` : ""}
    <div class="team-detail__stats">
      <article>
        <span>Competition</span>
        <strong>${escapeHtml(eventDisplayName(eventKeyForCard))}</strong>
      </article>
      <article>
        <span>Total OPR</span>
        <strong>${formatNumber(insight?.opr)}</strong>
      </article>
      <article>
        <span>Auto OPR</span>
        <strong>${formatNumber(insight?.autoOpr)}</strong>
      </article>
      <article>
        <span>Teleop OPR</span>
        <strong>${formatNumber(insight?.teleopOpr)}</strong>
      </article>
      <article>
        <span>Rank</span>
        <strong>${Number.isFinite(insight?.rank) ? insight.rank : "--"}</strong>
      </article>
      <article>
        <span>Stars</span>
        <strong>${starRating(detailStars) || "0 stars"}</strong>
      </article>
    </div>
    <div class="team-detail__table-wrap">
      <table class="team-detail__table">
        <thead>
          <tr>
            <th>Past Competition</th>
            <th>Rank</th>
            <th>OPR</th>
            <th>Auto OPR</th>
            <th>Teleop OPR</th>
            <th>Record</th>
            <th>Stars</th>
          </tr>
        </thead>
        <tbody>${rankRows}</tbody>
      </table>
    </div>
  `;
}

function getBestDetailEventKey(teamNumber, preferredEventKey) {
  if (state.eventTeamInsights.has(teamStatsKey(preferredEventKey, teamNumber))) {
    return preferredEventKey;
  }

  const history = getTeamEventHistory(teamNumber);
  return history[0]?.eventKey ?? preferredEventKey;
}

function getTeamEventHistory(teamNumber) {
  const rows = [];

  state.eventTeamInsights.forEach((insight, key) => {
    const { eventKey: keyEvent, teamNumber: keyTeam } = parseTeamStatsKey(key);
    if (keyTeam !== teamNumber) return;

    const stats = state.teamEventStats.get(key);
    rows.push({
      eventKey: keyEvent,
      eventName: eventDisplayName(keyEvent),
      eventTime: eventSortTime(keyEvent),
      rank: insight.rank,
      opr: insight.opr,
      autoOpr: insight.autoOpr,
      teleopOpr: insight.teleopOpr,
      record: stats
        ? `${stats.wins}-${stats.losses}-${stats.ties}`
        : Number.isFinite(insight.played)
          ? `${insight.wins}-${insight.losses}-${insight.ties}`
          : "--",
      stars: stats?.stars ?? insight.stars ?? 0,
    });
  });

  return rows.sort((a, b) => b.eventTime - a.eventTime);
}

function parseTeamStatsKey(key) {
  const parts = key.split(":");
  return {
    eventKey: `${parts[0]}:${parts[1]}`,
    teamNumber: Number(parts[2]),
  };
}

function getUpcomingMatch(rows) {
  return rows
    .filter((row) => isUpcoming(row))
    .sort((a, b) => getTime(a.scheduledStartTime) - getTime(b.scheduledStartTime))[0];
}

function eventKey(match) {
  return `${match.season}:${match.eventCode}`;
}

function eventName(match) {
  return state.events.get(eventKey(match))?.name ?? match.eventCode;
}

function detailEventKey(match) {
  return `${match.eventSeason}:${match.eventCode}`;
}

function teamStatsKey(key, teamNumber) {
  return `${key}:${teamNumber}`;
}

function eventDisplayName(key) {
  if (!key) return "Selected competition";
  return state.events.get(key)?.name ?? key.split(":")[1] ?? key;
}

function eventSortTime(key) {
  const event = state.events.get(key);
  const value = event?.end ?? event?.start ?? event?.dateEnd ?? event?.dateStart ?? event?.createdAt;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function buildEventTeamInsights() {
  const insights = new Map();

  state.eventTeamReports.forEach((reports, key) => {
    const rows = normalizeCollection(reports);
    const oprValues = rows
      .map((report) => getOprValue(report))
      .filter((value) => Number.isFinite(value));
    const minOpr = oprValues.length ? Math.min(...oprValues) : null;
    const maxOpr = oprValues.length ? Math.max(...oprValues) : null;
    const teamCount = rows.length;

    rows.forEach((report) => {
      const teamNumber = report.teamNumber;
      const rank = Number(report?.stats?.rank);
      const opr = getOprValue(report);
      const rankScore = Number.isFinite(rank) && teamCount > 1
        ? 1 - ((rank - 1) / (teamCount - 1))
        : null;
      const oprScore = Number.isFinite(opr) && Number.isFinite(minOpr) && Number.isFinite(maxOpr) && maxOpr > minOpr
        ? (opr - minOpr) / (maxOpr - minOpr)
        : null;
      const wins = Number(report?.stats?.wins) || 0;
      const losses = Number(report?.stats?.losses) || 0;
      const ties = Number(report?.stats?.ties) || 0;
      const played = Number(report?.stats?.qualMatchesPlayed) || wins + losses + ties;
      const winRate = played ? (wins + ties * 0.5) / played : null;
      const partnerAdjustedWinRate = getPartnerAdjustedWinRate(key, teamNumber, winRate);
      const ratingScore = weightedRatingScore([
        { value: oprScore, weight: 0.45 },
        { value: rankScore, weight: 0.35 },
        { value: partnerAdjustedWinRate, weight: 0.2 },
      ]);

      insights.set(teamStatsKey(key, teamNumber), {
        rank,
        opr,
        autoOpr: Number(report?.stats?.opr?.autoPoints),
        teleopOpr: Number(report?.stats?.opr?.dcPoints),
        wins,
        losses,
        ties,
        played,
        oprScore,
        rankScore,
        winRate,
        partnerAdjustedWinRate,
        ratingScore,
        stars: Number.isFinite(ratingScore) ? Math.round(ratingScore * 5) : null,
        source: "FTCScout OPR + event ranking + teammate-adjusted wins",
      });
    });
  });

  return insights;
}

function getOprValue(report) {
  return Number(report?.stats?.opr?.totalPoints ?? report?.stats?.opr?.totalPointsNp);
}

function getPartnerAdjustedWinRate(key, teamNumber, fallbackWinRate) {
  const matches = getEventMatches(key).filter((match) =>
    (match.teams ?? []).some((team) => team.teamNumber === teamNumber),
  );
  const ownOpr = state.eventTeamInsights.get(teamStatsKey(key, teamNumber))?.opr
    ?? getReportOpr(key, teamNumber);

  if (!matches.length || !Number.isFinite(ownOpr)) return fallbackWinRate;

  let score = 0;
  let played = 0;

  matches.forEach((match) => {
    const redScore = match?.scores?.red?.totalPoints;
    const blueScore = match?.scores?.blue?.totalPoints;
    const team = (match.teams ?? []).find((entry) => entry.teamNumber === teamNumber);

    if (!team || !Number.isFinite(redScore) || !Number.isFinite(blueScore)) return;

    const teamScore = team.alliance === "Red" ? redScore : blueScore;
    const otherScore = team.alliance === "Red" ? blueScore : redScore;
    const resultValue = teamScore > otherScore ? 1 : teamScore === otherScore ? 0.5 : 0;
    const partnerOprs = (match.teams ?? [])
      .filter((entry) => entry.alliance === team.alliance && entry.teamNumber !== teamNumber)
      .map((entry) => getReportOpr(key, entry.teamNumber))
      .filter((value) => Number.isFinite(value));
    const partnerAverage = partnerOprs.length
      ? partnerOprs.reduce((sum, value) => sum + value, 0) / partnerOprs.length
      : null;
    const teammateFactor = getTeammateFactor(ownOpr, partnerAverage);

    score += resultValue * teammateFactor;
    played += 1;
  });

  return played ? score / played : fallbackWinRate;
}

function getEventMatches(key) {
  const [eventSeason, eventCode] = key.split(":");
  return [...state.details.values()].filter((match) =>
    Number(match?.eventSeason) === Number(eventSeason) && match?.eventCode === eventCode,
  );
}

function getReportOpr(key, teamNumber) {
  const report = normalizeCollection(state.eventTeamReports.get(key))
    .find((entry) => entry.teamNumber === teamNumber);

  return getOprValue(report);
}

function getTeammateFactor(ownOpr, partnerAverage) {
  if (!Number.isFinite(partnerAverage)) return 1;
  if (partnerAverage <= 0) return 1.25;
  if (partnerAverage < ownOpr) return Math.min(1.25, Math.sqrt(ownOpr / partnerAverage));

  return Math.max(0.45, Math.min(1, ownOpr / partnerAverage));
}

function weightedRatingScore(parts) {
  const validParts = parts.filter((part) => Number.isFinite(part.value));
  const totalWeight = validParts.reduce((sum, part) => sum + part.weight, 0);

  if (!totalWeight) return null;
  const score = validParts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight;
  return Math.max(0, Math.min(1, score));
}

function buildTeamEventStats() {
  const stats = new Map();

  state.details.forEach((match) => {
    const redScore = match?.scores?.red?.totalPoints;
    const blueScore = match?.scores?.blue?.totalPoints;
    const key = detailEventKey(match);

    if (!isDetailInGameYear(match)) return;
    if (!Number.isFinite(redScore) || !Number.isFinite(blueScore)) return;

    (match.teams ?? []).forEach((team) => {
      const currentKey = teamStatsKey(key, team.teamNumber);
      const current = stats.get(currentKey) ?? {
        eventKey: key,
        teamNumber: team.teamNumber,
        wins: 0,
        losses: 0,
        ties: 0,
        played: 0,
      };
      const teamScore = team.alliance === "Red" ? redScore : blueScore;
      const otherScore = team.alliance === "Red" ? blueScore : redScore;

      current.played += 1;
      if (teamScore > otherScore) current.wins += 1;
      if (teamScore < otherScore) current.losses += 1;
      if (teamScore === otherScore) current.ties += 1;
      stats.set(currentKey, current);
    });
  });

  stats.forEach((record) => {
    const insight = state.eventTeamInsights.get(teamStatsKey(record.eventKey, record.teamNumber));

    record.winRate = record.played
      ? (record.wins + record.ties * 0.5) / record.played
      : 0;
    record.opr = insight?.opr ?? null;
    record.ratingScore = Number.isFinite(insight?.ratingScore) ? insight.ratingScore : record.winRate;
    record.ratingSource = insight?.source ?? "Match record";
    record.stars = Math.round(record.ratingScore * 5);
  });

  return stats;
}

function buildTeamEventRanks() {
  const ranks = new Map();
  const groupedStats = new Map();

  state.teamEventStats.forEach((record) => {
    const insight = state.eventTeamInsights.get(teamStatsKey(record.eventKey, record.teamNumber));

    if (Number.isFinite(insight?.rank)) {
      ranks.set(teamStatsKey(record.eventKey, record.teamNumber), insight.rank);
      return;
    }

    const records = groupedStats.get(record.eventKey) ?? [];
    records.push(record);
    groupedStats.set(record.eventKey, records);
  });

  groupedStats.forEach((records, key) => {
    records
      .sort((a, b) =>
        b.winRate - a.winRate ||
        b.wins - a.wins ||
        a.losses - b.losses ||
        Number(a.teamNumber) - Number(b.teamNumber),
      )
      .forEach((record, index) => {
        ranks.set(teamStatsKey(key, record.teamNumber), index + 1);
      });
  });

  return ranks;
}

function getTeamRating(teamNumber, matchEntry) {
  const currentEventKey = eventKey(matchEntry);
  const currentKey = teamStatsKey(currentEventKey, teamNumber);
  const currentStats = state.teamEventStats.get(currentKey);
  const resolved = currentStats?.played
    ? {
        stats: currentStats,
        rank: state.teamEventRanks.get(currentKey),
        sourceEventName: eventName(matchEntry),
        isFallback: false,
      }
    : findPreviousTeamEventRating(teamNumber, currentEventKey);

  return {
    teamNumber,
    eventKey: resolved?.stats?.eventKey ?? currentEventKey,
    name: state.teamNames.get(teamNumber) ?? `Team ${teamNumber}`,
    ...resolved,
  };
}

function findPreviousTeamEventRating(teamNumber, currentEventKey) {
  const currentTime = eventSortTime(currentEventKey);
  const candidates = [];

  state.teamEventStats.forEach((stats) => {
    if (stats.teamNumber !== teamNumber || stats.eventKey === currentEventKey || !stats.played) return;

    const eventTime = eventSortTime(stats.eventKey);
    if (Number.isFinite(currentTime) && Number.isFinite(eventTime) && eventTime >= currentTime) return;

    candidates.push({
      stats,
      rank: state.teamEventRanks.get(teamStatsKey(stats.eventKey, teamNumber)),
      sourceEventName: eventDisplayName(stats.eventKey),
      eventTime,
      isFallback: true,
    });
  });

  return candidates.sort((a, b) => b.eventTime - a.eventTime)[0] ?? {
    stats: null,
    rank: null,
    sourceEventName: "",
    isFallback: false,
  };
}

function formatTeamRatings(teams) {
  if (!teams.length) return "TBD";

  return `
    <div class="team-rating-list">
      ${teams.map(({ teamNumber, name, eventKey, stats, rank, sourceEventName, isFallback }) => {
        const record = stats ? `${stats.wins}-${stats.losses}-${stats.ties}` : "0-0-0";
        const stars = stats ? stats.stars : 0;
        const rate = stats ? `${Math.round(stats.winRate * 100)}%` : "--";
        const rankLabel = Number.isFinite(rank) ? ` / rank ${rank}` : "";
        const oprLabel = Number.isFinite(stats?.opr) ? ` / OPR ${stats.opr.toFixed(1)}` : "";
        const sourceLabel = isFallback && sourceEventName
          ? `<span class="rating-source">Stars from ${escapeHtml(sourceEventName)}</span>`
          : "";

        return `
          <div class="team-rating">
            <button class="team-link" type="button" data-team-number="${teamNumber}" data-event-key="${escapeHtml(eventKey)}">
              ${escapeHtml(name)}
            </button>
            <span>#${teamNumber}${rankLabel}</span>
            <span>${record} / ${rate}${oprLabel}</span>
            <span class="stars" aria-label="${stars} out of 5 stars">${starRating(stars)}</span>
            ${sourceLabel}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function formatMobileMatchCard(row) {
  const scoreLabel = Number.isFinite(row.redScore) && Number.isFinite(row.blueScore)
    ? `${row.redScore} - ${row.blueScore}`
    : "Pending";
  const resultLabel = row.result === "Pending" || row.result === "No score"
    ? row.result
    : `${row.result} for 7305`;

  return `
    <article class="mobile-match-card" aria-label="${escapeHtml(formatMatchName(row))} alliance matchup">
      <header class="mobile-match-card__header">
        <div>
          <strong>${formatMatchName(row)}</strong>
          <span>${escapeHtml(row.eventName)}</span>
        </div>
        <span class="mobile-match-card__result ${resultClass(row.result)}">${resultLabel}</span>
      </header>
      <div class="mobile-match-board">
        <div class="mobile-match-board__head mobile-match-board__head--match">Match</div>
        <div class="mobile-match-board__head mobile-match-board__head--red">Red Alliance</div>
        <div class="mobile-match-board__head mobile-match-board__head--blue">Blue Alliance</div>
        <div class="mobile-match-board__score">
          <strong>${scoreLabel}</strong>
          <span>${formatDate(row.scheduledStartTime)}</span>
        </div>
        <div class="mobile-alliance mobile-alliance--red">
          ${formatMobileAllianceTeams(row.redTeams)}
        </div>
        <div class="mobile-alliance mobile-alliance--blue">
          ${formatMobileAllianceTeams(row.blueTeams)}
        </div>
      </div>
    </article>
  `;
}

function formatMobileAllianceTeams(teams) {
  if (!teams.length) return `<div class="mobile-team mobile-team--empty">TBD</div>`;

  return teams.map(({ teamNumber, name, eventKey, stats, rank, sourceEventName, isFallback }) => {
    const record = stats ? `${stats.wins}-${stats.losses}-${stats.ties}` : "0-0-0";
    const stars = stats ? stats.stars : 0;
    const rankLabel = Number.isFinite(rank) ? `Rank ${rank}` : "Rank --";
    const oprLabel = Number.isFinite(stats?.opr) ? `OPR ${stats.opr.toFixed(1)}` : "OPR --";
    const clagueClass = teamNumber === TEAM_NUMBER ? " mobile-team--clague" : "";
    const sourceLabel = isFallback && sourceEventName
      ? `<small>Stars from ${escapeHtml(sourceEventName)}</small>`
      : "";

    return `
      <div class="mobile-team${clagueClass}">
        <button class="team-link mobile-team__name" type="button" data-team-number="${teamNumber}" data-event-key="${escapeHtml(eventKey)}">
          <span>${teamNumber}</span>
          ${escapeHtml(name)}
        </button>
        <div class="mobile-team__meta">${rankLabel} / ${record} / ${oprLabel}</div>
        <div class="stars" aria-label="${stars} out of 5 stars">${starRating(stars)}</div>
        ${sourceLabel}
      </div>
    `;
  }).join("");
}

function starRating(stars) {
  const filled = Math.max(0, Math.min(5, stars));
  return filled ? "&#9733;".repeat(filled) : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMatchName(row) {
  const id = Number(row.matchId);
  if (id >= 20000) return `Playoff ${id}`;
  return `Match ${id}`;
}

function matchType(id) {
  return Number(id) >= 20000 ? "Playoff" : "Quals";
}

function formatScore(row) {
  if (!Number.isFinite(row.redScore) || !Number.isFinite(row.blueScore)) {
    return "Pending";
  }
  return `<span class="score-red">${row.redScore}</span> - <span class="score-blue">${row.blueScore}</span>`;
}

function getResult(myScore, oppScore) {
  if (!Number.isFinite(myScore) || !Number.isFinite(oppScore)) return "Pending";
  if (myScore > oppScore) return "Win";
  if (myScore < oppScore) return "Loss";
  return "Tie";
}

function isUpcoming(row) {
  const matchTime = getTime(row.scheduledStartTime);
  const now = Date.now();

  if (row.hasBeenPlayed === false) return true;
  return Number.isFinite(matchTime) && matchTime > now;
}

function getTime(value) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function resultClass(result) {
  return {
    Win: "result result--win",
    Loss: "result result--loss",
    Tie: "result result--tie",
  }[result] ?? "result";
}

function formatDate(value) {
  if (!value) return "TBD";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "TBD";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "--";
}

function isMatchInGameYear(match) {
  return Number(match.season) === ftcScoutSeasonForGameYear(state.year);
}

function isDetailInGameYear(match) {
  return Number(match?.eventSeason) === ftcScoutSeasonForGameYear(state.year);
}

function getSeasonLabel(year) {
  const numericYear = Number(year);
  return GAME_SEASONS[numericYear] ?? `${numericYear - 1}-${numericYear}`;
}

function ftcScoutSeasonForGameYear(year) {
  return Number(year) - 1;
}

function setLoading() {
  els.teamName.textContent = "Loading...";
  els.teamLocation.textContent = "FTC team profile";
  els.matchCount.textContent = "--";
  els.eventCount.textContent = "Across -- events";
  els.recordCount.textContent = "--";
  els.avgScore.textContent = "Avg alliance score --";
  els.latestMatch.textContent = "--";
  els.latestEvent.textContent = "Waiting for data";
  els.clagueRating.innerHTML = `
    <span>Clague rating</span>
    <strong>Loading...</strong>
    <small>Waiting for FTCScout data</small>
  `;
  els.upcomingCard.innerHTML = `<div class="empty">Loading next match...</div>`;
  els.picksStatus.textContent = "Ranking teams from FTCScout data...";
  els.picksList.innerHTML = `<div class="empty">Loading pick list...</div>`;
  els.matchBody.innerHTML = `<tr><td colspan="8" class="empty">Loading matches from FTCScout...</td></tr>`;
  setStatus("Loading FTCScout data...");
}

function setStatus(message) {
  els.status.textContent = message;
}
