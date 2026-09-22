/** PM2 example. Put secrets in the process env / a root .env, not in git. */
module.exports = {
  apps: [
    {
      name: "aliens-apms-test",
      cwd: "/home/alienstattoo-app/htdocs/app.alienstattoo.in",
      script: ".output/server/index.mjs",
      interpreter: "node",
      env: {
        PORT: 3010,
        HOST: "0.0.0.0",
        NITRO_HOST: "0.0.0.0",
        NITRO_PRESET: "node-server",
        VITE_AUTH_ENABLED: "true",
      },
    },
    // Cut over only after staging is good:
    // {
    //   name: "aliens-apms",
    //   cwd: "/home/alienstattoo-app/htdocs/app.alienstattoo.in",
    //   script: ".output/server/index.mjs",
    //   interpreter: "node",
    //   env: {
    //     PORT: 3000,
    //     HOST: "0.0.0.0",
    //     NITRO_HOST: "0.0.0.0",
    //     NITRO_PRESET: "node-server",
    //     VITE_AUTH_ENABLED: "true",
    //   },
    // },
  ],
};
