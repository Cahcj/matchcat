const API_ROOT = "https://api.ftcscout.org/rest/v1";
const TEAM_NUMBER = 7305;

const state = {
  team: TEAM_NUMBER,
  year: 2026,
  teamInfo: null,
  participation: [],
  details: new Map(),
  events: new Map(),
  opponentStats: new Map(),
  teamNames: new Map(),
  eventFilter: "all",
};

const els = {
  form: document.querySelector("#tracker-form"),
  yearInput: document.querySelector("#year-input"),
  eventFilter: document.querySelector("#event-filter"),
  status: document.querySelector("#status"),
  teamTitle: document.querySelector("#team-title"),
  teamName: document.querySelector("#team-name"),
  teamLocation: document.querySelector("#team-location"),
  matchCount: document.querySelector("#match-count"),
  eventCount: document.querySelector("#event-count"),
  recordCount: document.querySelector("#record-count"),
  avgScore: document.querySelector("#avg-score"),
  latestMatch: document.querySelector("#latest-match"),
  latestEvent: document.querySelector("#latest-event"),
  upcomingCard: document.querySelector("#upcoming-card"),
  matchBody: document.querySelector("#match-body"),
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextYear = Number.parseInt(els.yearInput.value, 10);

  if (!Number.isFinite(nextYear)) {
    setStatus("Choose a valid game year.");
    return;
  }

  state.team = TEAM_NUMBER;
  state.year = nextYear;
  loadTracker();
});

els.eventFilter.addEventListener("change", () => {
  state.eventFilter = els.eventFilter.value;
  render();
});

loadTracker();

async function loadTracker() {
  setLoading();
  state.details = new Map();
  state.events = new Map();
  state.opponentStats = new Map();
  state.teamNames = new Map();
  state.eventFilter = "all";
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
    state.opponentStats = buildOpponentStats();
    await loadOpponentTeamNames();
    populateEventFilter();
    render();
    setStatus(`Updated from FTCScout for ${state.year} games.`);
  } catch (error) {
    console.error(error);
    setStatus("FTCScout data could not load right now.");
    els.matchBody.innerHTML = `<tr><td colspan="8" class="empty">No live data returned for this team and game year.</td></tr>`;
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
      const response = await getJson(
        `${API_ROOT}/events/${season}/${eventCode}/matches`,
      );
      const eventInfo = await getJson(`${API_ROOT}/events/${season}/${eventCode}`);
      const matches = normalizeCollection(response);
      state.events.set(`${season}:${eventCode}`, eventInfo);
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
  renderUpcomingMatch(upcomingMatch);
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
        .map((teamNumber) => ({
          teamNumber,
          name: state.teamNames.get(teamNumber) ?? `Team ${teamNumber}`,
          stats: state.opponentStats.get(teamNumber),
        }));
      const opponents = opponentTeams.map((teamNumber) => ({
        teamNumber,
        name: state.teamNames.get(teamNumber) ?? `Team ${teamNumber}`,
        stats: state.opponentStats.get(teamNumber),
      }));

      return {
        ...entry,
        detail,
        eventKey: eventKey(entry),
        eventName: eventName(entry),
        partners,
        opponents,
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

function renderMatches(rows) {
  if (!rows.length) {
    els.matchBody.innerHTML = `<tr><td colspan="8" class="empty">No matches found for this filter.</td></tr>`;
    return;
  }

  els.matchBody.innerHTML = rows.map((row) => {
    const allianceClass = row.alliance === "Red" ? "pill--red" : "pill--blue";

    return `
      <tr>
        <td>
          <div class="match-title">
            <strong>${formatMatchName(row)}</strong>
            <span>${row.tournamentLevel}</span>
          </div>
        </td>
        <td>${escapeHtml(row.eventName)}</td>
        <td><span class="pill ${allianceClass}">${row.alliance} ${row.station}</span></td>
        <td>${formatTeamRatings(row.partners)}</td>
        <td>${formatTeamRatings(row.opponents)}</td>
        <td>${formatScore(row)}</td>
        <td class="${resultClass(row.result)}">${row.result}</td>
        <td>${formatDate(row.scheduledStartTime)}</td>
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

function buildOpponentStats() {
  const stats = new Map();

  state.details.forEach((match) => {
    const redScore = match?.scores?.red?.totalPoints;
    const blueScore = match?.scores?.blue?.totalPoints;

    if (!isDetailInGameYear(match)) return;
    if (!Number.isFinite(redScore) || !Number.isFinite(blueScore)) return;

    (match.teams ?? []).forEach((team) => {
      const current = stats.get(team.teamNumber) ?? {
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
      stats.set(team.teamNumber, current);
    });
  });

  stats.forEach((record) => {
    record.winRate = record.played
      ? (record.wins + record.ties * 0.5) / record.played
      : 0;
    record.stars = Math.round(record.winRate * 5);
  });

  return stats;
}

function formatTeamRatings(teams) {
  if (!teams.length) return "TBD";

  return `
    <div class="team-rating-list">
      ${teams.map(({ teamNumber, name, stats }) => {
        const record = stats ? `${stats.wins}-${stats.losses}-${stats.ties}` : "0-0-0";
        const stars = stats ? stats.stars : 0;
        const rate = stats ? `${Math.round(stats.winRate * 100)}%` : "--";

        return `
          <div class="team-rating">
            <strong>${escapeHtml(name)}</strong>
            <span>#${teamNumber}</span>
            <span>${record} / ${rate}</span>
            <span class="stars" aria-label="${stars} out of 5 stars">${starRating(stars)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
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

function isMatchInGameYear(match) {
  return Number(match.season) === ftcScoutSeasonForGameYear(state.year);
}

function isDetailInGameYear(match) {
  return Number(match?.eventSeason) === ftcScoutSeasonForGameYear(state.year);
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
  els.upcomingCard.innerHTML = `<div class="empty">Loading next match...</div>`;
  els.matchBody.innerHTML = `<tr><td colspan="8" class="empty">Loading matches from FTCScout...</td></tr>`;
  setStatus("Loading FTCScout data...");
}

function setStatus(message) {
  els.status.textContent = message;
}
