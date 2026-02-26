const http = require('http');

const server = http.createServer(async (req, res) => {
    try {
        const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;

        if (req.method === 'GET' && req.url === '/serverdata') {
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(`{
  "menu-version": "8.3.0",
  "min-version": "0.0.0",
  "min-console-version": "0.0.0",
  "discord-invite": "https://discord.gg/iidk",
  "motd": `+"\"This menu has been discontinued. It will no longer be receiving updates, please switch to Seralyth or another LTS fork. Thank you for 2 years of service, I had fun, and I wish even the ones who hated me the best lives.  ~ crimsoncauldron\n\nVersion: {0}\nCurrent status: <b>Deprecated</b>\nMade with <3 by iiDk, kingofnetflix, and others\n<alpha=128>{2} {0} {3}<alpha=255>\","+`
  "admins": [
  ],
  "super-admins": [
  ],
  "patreon": [
  ],
  "detected-mods": [],
  "poll": "The menu has been discontinued. Please switch menus soon, as ii's Stupid Menu will stop functioning.",
  "option-a": "<3",
  "option-b": "Luv yall"
}`);
            return;
        }

        console.log(`${clientIp} ${req.method} ${req.url}`);
        res.writeHead(500).end(JSON.stringify({ status: 500, message: "I don't really know what to do with this URL anymore" })); return;
    } catch (err) {
        console.error('Error processing request:', err.message);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 500, error: err.message }));
        }
    }
});

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}/`);
});