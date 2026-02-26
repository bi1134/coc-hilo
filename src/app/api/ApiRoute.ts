export var useMock = true;
export var TOKEN = "";

export function getToken(): { useMock: boolean; token: string } {
  const urlParams = Object.fromEntries(
    new URLSearchParams(window.location.search),
  );
  let temp: boolean;

  // Check URL param for explicit mock control
  if (urlParams?.useMock === "true") {
    temp = true;
  } else if (urlParams?.useMock === "false") {
    // Explicit real API mode
    temp = false;
  } else if (urlParams?.token) {
    // Has token = use real API
    temp = false;
  } else {
    // No token, no explicit setting = default to mock for local dev
    temp = true;
  }

  TOKEN = urlParams?.token || "";
  useMock = temp;

  console.log(`[API] Mode: ${temp ? 'MOCK' : 'REAL API'}, Token: ${TOKEN ? 'present' : 'missing'}`);

  return { useMock: temp, token: TOKEN };
}

export function getBaseUrl(): string {
  // return "https://mngs.nasisoto.org/games/minigame/"; // OLD - wrong path
  return "https://mngs.nasisoto.org/games/minigames/";
  // return "http://backend.integration-api.net/games/minigames/";
}

export enum ApiRoute {
  LAST_ACTIVITY = "last-activity",
  BET = "bet",
  SKIP = "skip",
  PICK = "pick",
  CASHOUT = "cashout",
  RESULT = "result",
  HISTORY = "history",
  HISTORY_DETAIL = "history-detail"
}
