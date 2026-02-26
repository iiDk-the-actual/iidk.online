const http = require('http');

const server = http.createServer(async (req, res) => {
    try {
        const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
        const ipHash = hashIpAddr(clientIp);

        console.log(`${ipHash} ${req.method} ${req.url}`);
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