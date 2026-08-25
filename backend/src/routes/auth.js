import {
  authenticate,
  authMiddleware,
  clearSession,
  createUser,
  currentUser,
  deleteUser,
  listUsers,
  publicUser,
  setSession,
} from "../auth.js";

export function mountAuthRoutes(app) {
  app.get("/api/auth/me", async (req, res) => {
    const users = await listUsers();
    const user = await currentUser(req);
    res.json({ user, setup: users.length === 0, members: users.length });
  });

  app.post("/api/auth/setup", async (req, res) => {
    const users = await listUsers();
    if (users.length) return res.status(409).json({ error: "Workspace already has an owner" });
    try {
      const user = await createUser({
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
        role: "owner",
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
