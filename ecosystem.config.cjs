// PM2 process definition for the Raspberry Pi. Set up once:
//   cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
//   pm2 start ecosystem.config.cjs
//   pm2 save      # remember the process list
//   pm2 startup   # run the printed command once, to auto-start on boot
module.exports = {
  apps: [
    {
      name: 'church-admin-web',
      script: '.venv/bin/python',
      args: '-m uvicorn app.main:app --host 0.0.0.0 --port 8000',
      // Resolve .env, schedules.json and the venv from the backend root.
      cwd: `${__dirname}/backend`,
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      kill_timeout: 5000
    }
  ]
};
