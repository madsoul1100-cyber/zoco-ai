module.exports = {
  apps: [
    {
      name: "zoco-api",
      cwd: "./backend",
      script: "src/server.js",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      env: {
        NODE_ENV: "production",
        PORT: 8787,
      },
    },
    {
      name: "zoco-web",
      cwd: "./frontend",
      script: "npm",
      args: "run preview -- --host 0.0.0.0 --port 5173",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
