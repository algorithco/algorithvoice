import { createHmac } from "node:crypto";
import { createSigner, createVerifier } from "fast-jwt";

const CONTEXT = "algorith-voice/oauth-state/v1";

export interface OAuthStateClaims {
  typ: "oauth_state";
  provider: string;
  device: string;
  cb: string;
  s?: string;
  n?: string;
}

function stateKey(masterSecret: string): Buffer {
  return createHmac("sha256", masterSecret).update(CONTEXT).digest();
}

export function signOAuthState(
  masterSecret: string,
  claims: Omit<OAuthStateClaims, "typ">,
): string {
  const sign = createSigner<OAuthStateClaims>({
    key: stateKey(masterSecret),
    algorithm: "HS256",
    expiresIn: "10m",
    iss: "algorith-voice",
    aud: "oauth-state",
    header: { alg: "HS256", typ: "oauth_state" },
  });
  return sign({ typ: "oauth_state", ...claims });
}

export function verifyOAuthState(
  masterSecret: string,
  token: string,
): OAuthStateClaims {
  const verify = createVerifier({
    key: stateKey(masterSecret),
    algorithms: ["HS256"],
    allowedIss: "algorith-voice",
    allowedAud: "oauth-state",
    requiredClaims: ["typ", "provider", "device", "cb"],
    checkTyp: "oauth_state",
  });
  const claims = verify(token) as Partial<OAuthStateClaims>;
  if (
    claims.typ !== "oauth_state" ||
    typeof claims.provider !== "string" ||
    typeof claims.device !== "string" ||
    typeof claims.cb !== "string"
  ) {
    throw new Error("invalid OAuth state");
  }
  return claims as OAuthStateClaims;
}
