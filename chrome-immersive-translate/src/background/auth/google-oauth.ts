import { getOAuthToken, getSettings, setOAuthToken } from "../../shared/storage";

const SCOPES = [
  "https://www.googleapis.com/auth/generative-language",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function redirectUri(): string {
  return `https://${chrome.runtime.id}.chromiumapp.org/`;
}

function randomString(len = 64): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ("0" + (b % 36).toString(36)).slice(-2))
    .join("")
    .slice(0, len);
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let str = "";
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function loginGoogleGemini(): Promise<{ email?: string }> {
  const settings = await getSettings();
  const clientId = settings.googleOAuthClientId.trim();
  if (!clientId) {
    throw new Error(
      "请先在设置中填写 Google OAuth 客户端 ID（类型：Chrome 扩展 或 桌面应用，并配置重定向 URI）。"
    );
  }

  const verifier = randomString(64);
  const challenge = await sha256Base64Url(verifier);
  const state = randomString(24);
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  const redirected = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });
  if (!redirected) throw new Error("OAuth 已取消");

  const ret = new URL(redirected);
  const err = ret.searchParams.get("error");
  if (err) throw new Error(`OAuth 错误: ${err}`);
  const code = ret.searchParams.get("code");
  const retState = ret.searchParams.get("state");
  if (!code) throw new Error("未收到授权码");
  if (retState !== state) throw new Error("OAuth state 不匹配");

  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text().catch(() => "");
    throw new Error(`换取 token 失败 ${tokenRes.status}: ${t.slice(0, 200)}`);
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  let email: string | undefined;
  try {
    const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (info.ok) {
      const u = (await info.json()) as { email?: string };
      email = u.email;
    }
  } catch {
    /* ignore */
  }

  await setOAuthToken("gemini", {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt: Date.now() + (tokenJson.expires_in ?? 3600) * 1000 - 60_000,
    email,
  });

  return { email };
}

export async function logoutGoogleGemini(): Promise<void> {
  const token = await getOAuthToken("gemini");
  if (token?.accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`, {
        method: "POST",
      });
    } catch {
      /* ignore */
    }
  }
  await setOAuthToken("gemini", null);
}

export async function getValidGeminiAccessToken(): Promise<string | null> {
  const token = await getOAuthToken("gemini");
  if (!token?.accessToken) return null;
  if (token.expiresAt && token.expiresAt > Date.now() + 30_000) {
    return token.accessToken;
  }
  if (!token.refreshToken) return token.accessToken;

  const settings = await getSettings();
  const clientId = settings.googleOAuthClientId.trim();
  if (!clientId) return token.accessToken;

  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: token.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    access_token: string;
    expires_in?: number;
    refresh_token?: string;
  };
  await setOAuthToken("gemini", {
    ...token,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? token.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  });
  return json.access_token;
}
