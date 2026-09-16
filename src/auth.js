import http from 'node:http';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import os from 'node:os';
import chalk from 'chalk';
import ora from 'ora';

/**
 * Generate PKCE code verifier and code challenge (S256)
 */
export function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Open URL in the user's default browser
 */
export function openBrowser(url) {
  const platform = os.platform();
  let cmd = '';

  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, () => {
    // Ignore spawn errors silently since link is also printed
  });
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Duddy AI — Успешная авторизация</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #090d16;
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 20px;
      padding: 44px 36px;
      text-align: center;
      max-width: 440px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .icon {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #10b981;
      font-size: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    h1 {
      color: #38bdf8;
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 12px;
      letter-spacing: -0.5px;
    }
    p {
      color: #94a3b8;
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .badge {
      display: inline-block;
      padding: 6px 16px;
      background: #1e293b;
      color: #38bdf8;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid #334155;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Duddy AI подключен!</h1>
    <p>API ключ успешно передан в консоль. Можете закрыть эту вкладку и вернуться в терминал.</p>
    <div class="badge">Вкладку можно закрыть</div>
  </div>
  <script>
    setTimeout(() => {
      try { window.close(); } catch(e) {}
    }, 3000);
  </script>
</body>
</html>`;

/**
 * Run PKCE OAuth browser authentication flow
 */
export async function loginViaBrowser() {
  const { codeVerifier, codeChallenge } = generatePKCE();

  return new Promise((resolve) => {
    let resolved = false;

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://${req.headers.host}`);

        if (reqUrl.pathname === '/callback') {
          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<h1>Ошибка авторизации: ${error}</h1><p>Вернитесь в терминал.</p>`);
            cleanup();
            resolve(null);
            return;
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(SUCCESS_HTML);

            spinner.text = chalk.cyan('Обмен кода авторизации на API ключ...');

            try {
              const exchangeRes = await fetch('https://openrouter.ai/api/v1/auth/keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  code: code,
                  code_verifier: codeVerifier,
                  code_challenge_method: 'S256'
                })
              });

              if (!exchangeRes.ok) {
                const errData = await exchangeRes.text();
                throw new Error(`OpenRouter rejected code exchange: ${errData}`);
              }

              const data = await exchangeRes.json();
              cleanup();
              resolve(data.key);
              return;
            } catch (exchangeErr) {
              console.error(chalk.red(`\nОшибка обмена токена: ${exchangeErr.message}`));
              cleanup();
              resolve(null);
              return;
            }
          }
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } catch (err) {
        cleanup();
        resolve(null);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const callbackUrl = `http://localhost:${port}/callback`;
      const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

      console.log(chalk.bold.cyan('\n🌐 Авторизация через браузер'));
      console.log(chalk.dim('Открываем страницу входа OpenRouter...'));
      console.log(chalk.dim('Если браузер не открылся автоматически, перейдите по ссылке:\n'));
      console.log(`  ${chalk.underline.hex('#38bdf8')(authUrl)}\n`);

      openBrowser(authUrl);

      spinner.start();
    });

    const spinner = ora({
      text: chalk.bold.hex('#38bdf8')('Ожидание подтверждения входа в браузере... ') + chalk.dim('(Ctrl+C для отмены)'),
      color: 'cyan'
    });

    // Timeout after 120 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        spinner.stop();
        console.log(chalk.yellow('\n⏳ Время ожидания авторизации в браузере истекло (2 минуты).\n'));
        cleanup();
        resolve(null);
      }
    }, 120000);

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      spinner.stop();
      try {
        server.close();
      } catch (e) {}
    };
  });
}
