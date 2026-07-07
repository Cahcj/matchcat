const API_ROOT = "https://api.ftcscout.org/rest/v1";

const state = {
  team: 7305,
  year: 2026,
  teamInfo: null,
  participation: [],
  details: new Map(),
  opponentStats: new Map(),
  eventFilter: "all",
};

const els = {
  form: document.querySelector("#tracker-form"),
  teamInput: document.querySelector("#team-input"),
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
  eventStrip: document.querySelector("#event-strip"),
  matchBody: document.querySelector("#match-body"),
};

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextTeam = Number.parseInt(els.teamInput.value, 10);
  const nextYear = Number.parseInt(els.yearInput.value, 10);

  if (!Number.isFinite(nextTeam) || !Number.isFinite(nextYear)) {
    setStatus("Enter a valid team number and game year.");
    return;
  }

  state.team = nextTeam;
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
  state.opponentStats = new Map();
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
  const candidateSeasons = [...new Set([year - 1, year])];
  const responses = await Promise.allSettled(
    candidateSeasons.map((season) =>
      getJson(`${API_ROOT}/teams/${state.team}/matches?season=${season}`),
    ),
  );

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
      const matches = normalizeCollection(response);
      matches.forEach((match) => {
        state.details.set(`${match.eventSeason}:${eventCode}:${match.id}`, match);
      });
    } catch (error) {
      console.warn(`Could not load details for ${eventCode}`, error);
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
  const codes = [...new Set(state.participation.map((match) => match.eventCode))].sort();
  els.eventFilter.innerHTML = `<option value="all">All events</option>`;
  codes.forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code;
    els.eventFilter.append(option);
  });
}

function render() {
  const rows = getRows();
  const visibleRows =
    state.eventFilter === "all"
      ? rows
      : rows.filter((row) => row.eventCode === state.eventFilter);

  renderSummary(rows, visibleRows);
  renderEvents(rows);
  renderMatches(visibleRows);
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
      const partners = allianceTeams.filter((teamNumber) => teamNumber !== state.team);
      const opponents = opponentTeams.map((teamNumber) => ({
        teamNumber,
        stats: state.opponentStats.get(teamNumber),
      }));

      return {
        ...entry,
        detail,
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
      const eventSort = String(a.eventCode).localeCompare(String(b.eventCode));
      return eventSort || Number(a.matchId) - Number(b.matchId);
    });
}

function renderSummary(allRows, visibleRows) {
  const team = state.teamInfo;
  const eventCodes = new Set(allRows.map((row) => row.eventCode));
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
  els.latestEvent.textContent = latest ? `${latest.eventCode} / ${formatDate(latest.scheduledStartTime)}` : "Waiting for data";
}

function renderEvents(rows) {
  const events = [...rows.reduce((map, row) => {
    const current = map.get(row.eventCode) ?? { code: row.eventCode, matches: 0, wins: 0, scored: [] };
    current.matches += 1;
    if (row.result === "Win") current.wins += 1;
    if (Number.isFinite(row.myScore)) current.scored.push(row.myScore);
    map.set(row.eventCode, current);
    return map;
  }, new Map()).values()].sort((a, b) => a.code.localeCompare(b.code));

  els.eventStrip.innerHTML = events.map((event) => {
    const avg = event.scored.length
      ? Math.round(event.scored.reduce((sum, score) => sum + score, 0) / event.scored.length)
      : "--";
    return `
      <article class="event-card">
        <strong>${event.code}</strong>
        <span>${event.matches} matches / ${event.wins} wins / avg ${avg}</span>
      </article>
    `;
  }).join("");
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
        <td>${row.eventCode}</td>
        <td><span class="pill ${allianceClass}">${row.alliance} ${row.station}</span></td>
        <td>${row.partners.length ? row.partners.join(", ") : "TBD"}</td>
        <td>${formatOpponents(row.opponents)}</td>
        <td>${formatScore(row)}</td>
        <td class="${resultClass(row.result)}">${row.result}</td>
        <td>${formatDate(row.scheduledStartTime)}</td>
      </tr>
    `;
  }).join("");
}

function buildOpponentStats() {
  const stats = new Map();

  state.details.forEach((match) => {
    const redScore = match?.scores?.red?.totalPoints;
    const blueScore = match?.scores?.blue?.totalPoints;

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

function formatOpponents(opponents) {
  if (!opponents.length) return "TBD";

  return `
    <div class="opponent-list">
      ${opponents.map(({ teamNumber, stats }) => {
        const record = stats ? `${stats.wins}-${stats.losses}-${stats.ties}` : "0-0-0";
        const stars = stats ? stats.stars : 0;
        const rate = stats ? `${Math.round(stats.winRate * 100)}%` : "--";

        return `
          <div class="opponent">
            <strong>${teamNumber}</strong>
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
  return "★".repeat(filled) + "☆".repeat(5 - filled);
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
  const detail = state.details.get(`${match.season}:${match.eventCode}:${match.matchId}`);
  const dateValue = detail?.scheduledStartTime ?? match.createdAt ?? match.updatedAt;
  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return Number(match.season) === state.year - 1;
  }

  return date.getFullYear() === state.year;
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
  els.eventStrip.innerHTML = "";
  els.matchBody.innerHTML = `<tr><td colspan="8" class="empty">Loading matches from FTCScout...</td></tr>`;
  setStatus("Loading FTCScout data...");
}

function setStatus(message) {
  els.status.textContent = message;
}
