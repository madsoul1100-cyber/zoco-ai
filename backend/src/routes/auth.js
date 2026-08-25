import {
  authenticate,
  authMethods,
  authMiddleware,
  clearSession,
  createUser,
  currentUser,
  deleteUser,
  exchangeGoogleCode,
  guestUser,
  googleAuthUrl,
  listUsers,
  publicUser,
  readOAuthState,
  sendPhoneOtp,
  setGuestSession,
  setSession,
  skipLoginAllowed,
  upsertIdentity,
  verifyGoogleIdToken,
  verifyPhoneOtp,
} from "../auth.js";

function appHome(req) {
  return String(process.env.PUBLIC_APP_URL || "").replace(/\/$/, "") || `${req.protocol}://${req.get("host")}/`;
}

export function mountAuthRoutes(app) {
  app.get("/api/auth/me", async (req, res) => {
    const users = await listUsers();
    const user = await currentUser(req);
    res.json({
      user,
      setup: users.length === 0,
      members: users.length,
      methods: await authMethods(),
    });
  });

  app.post("/api/auth/skip", (_req, res) => {
    if (!skipLoginAllowed()) {
      return res.status(403).json({ error: "Login is required" });
    }
    setGuestSession(res);
    res.json({ user: publicUser(guestUser()) });
  });

  app.post("/api/auth/setup", async (req, res) => {
    const users = await listUsers();
    if (users.length) return res.status(409).json({ error: "Workspace already has an owner. Create an account instead." });
    try {
      const user = await createUser({
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
        phone: req.body?.phone,
        role: "owner",
      });
      setSession(res, user);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const user = await createUser({
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
        phone: req.body?.phone,
      });
      setSession(res, user);
      res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const user = await authenticate(req.body?.email, req.body?.password);
      setSession(res, user);
      res.json({ user: publicUser(user) });
    } catch (error) {
      res.status(401).json({ error: error.message, auth: true });
    }
  });

  app.post("/api/auth/google", async (req, res) => {
    try {
      const profile = await verifyGoogleIdToken(req.body?.credential || req.body?.idToken);
      const user = await upsertIdentity(profile);
      setSession(res, user);
      res.json({ user: publicUser(user) });
    } catch (error) {
      res.status(401).json({ error: error.message, auth: true });
    }
  });

  app.get("/api/auth/google", async (req, res) => {
    try {
      res.redirect(googleAuthUrl(req));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    try {
      const state = readOAuthState(req.query.state);
      if (!state || state.t !== "google") throw new Error("Google sign-in expired. Try again.");
      const profile = await exchangeGoogleCode(req, req.query.code);
      const user = await upsertIdentity(profile);
      setSession(res, user);
      res.redirect(appHome(req));
    } catch (error) {
      const dest = new URL(appHome(req));
      dest.searchParams.set("authError", error.message);
      res.redirect(dest.toString());
    }
  });

  app.post("/api/auth/phone/send", async (req, res) => {
    try {
      res.json(await sendPhoneOtp(req.body?.phone));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/auth/phone/verify", async (req, res) => {
    try {
      const user = await verifyPhoneOtp(req.body?.phone, req.body?.code);
      setSession(res, user);
      res.json({ user: publicUser(user) });
    } catch (error) {
      res.status(401).json({ error: error.message, auth: true });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  app.get("/api/members", async (_req, res) => {
    const users = await listUsers();
    res.json(users.map(publicUser));
  });

  app.post("/api/members", async (req, res) => {
    if (req.user && req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the workspace owner can add members" });
    }
    try {
      const user = await createUser({
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
        phone: req.body?.phone,
        role: req.body?.role === "owner" ? "owner" : "member",
      });
      res.status(201).json(publicUser(user));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete("/api/members/:id", async (req, res) => {
    if (req.user && req.user.role !== "owner") {
      return res.status(403).json({ error: "Only the workspace owner can remove members" });
    }
    if (req.user?.id === req.params.id) {
      return res.status(400).json({ error: "You cannot remove yourself" });
    }
    await deleteUser(req.params.id);
    res.json({ ok: true });
  });
}

export { authMiddleware };
