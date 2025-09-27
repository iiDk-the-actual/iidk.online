const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const crypto = require('crypto');
const { exec } = require('child_process');

let bannedIds = [];
let DISCORD_WEBHOOK_URL = '';
if (fs.existsSync('/home/iidk/site/webhook.txt')) {
    DISCORD_WEBHOOK_URL = fs.readFileSync('/home/iidk/site/webhook.txt', 'utf8').trim();
    console.log('Set webhook');
} else {
    console.log('Webhook file does not exist.');
}

let SYNCDATA_WEBHOOK_URL = '';
if (fs.existsSync('/home/iidk/site/syncwebhook.txt')) {
    SYNCDATA_WEBHOOK_URL = fs.readFileSync('/home/iidk/site/syncwebhook.txt', 'utf8').trim();
    console.log('Set syncwebhook');
} else {
    console.log('Syncwebhook file does not exist.');
}

let BANDATA_WEBHOOK_URL = '';
if (fs.existsSync('/home/iidk/site/banwebhook.txt')) {
    BANDATA_WEBHOOK_URL = fs.readFileSync('/home/iidk/site/banwebhook.txt', 'utf8').trim();
    console.log('Set syncwebhook');
} else {
    console.log('Banwebhook file does not exist.');
}

let SECRET_KEY = '';
if (fs.existsSync('/home/iidk/site/secret.txt')) {
    SECRET_KEY = fs.readFileSync('/home/iidk/site/secret.txt', 'utf8').trim();
    console.log('Set secret');
} else {
    console.log('Secret file does not exist.');
}

let serverData = '{"error":"No data"}';
function updateServerData() {
    if (fs.existsSync('/home/iidk/site/serverdata.json')) {
        serverData = fs.readFileSync('/home/iidk/site/serverdata.json', 'utf8').trim();
        console.log('Loaded serverdata');
    }
}
updateServerData();

let playerIdMap = {};

if (fs.existsSync('/home/iidk/site/playerids.txt')) {
    const fileContent = fs.readFileSync('/home/iidk/site/playerids.txt', 'utf8').trim();
    const lines = fileContent.split('\n');

    for (const line of lines) {
        const [id, name] = line.split(';');
        if (id && name) {
            playerIdMap[id.trim()] = name.trim();
        }
    }

    console.log('Loaded playerIdMap');
} else {
    console.log('Player IDs file does not exist.');
}

if (fs.existsSync('/home/iidk/site/bannedids.txt')) {
    const fileContent = fs.readFileSync('/home/iidk/site/bannedids.txt', 'utf8').trim();
    bannedIds = fileContent.split('\n');

    console.log('Loaded banend ids');
} else {
    console.log('Banned IDs file does not exist.');
}

const ipRequestTimestamps = {};
const syncDataRequestTimestamps = {};
const reportBanRequestTimestamps = {};
const getFriendTime = {};
const friendModifyTime = {};
const bannedIps = {};
const activeUsers = {};
const activeRooms = {};
const activeUserData = {};

function cleanAndFormatData(data) {
    const cleanedData = {};

    cleanedData.directory = data.directory.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
    cleanedData.identity = data.identity.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
    cleanedData.region = data.region.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
    cleanedData.userid = data.userid.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20);
    cleanedData.isPrivate = data.isPrivate;
    cleanedData.playerCount = Math.min(Math.max(data.playerCount, -1), 10);
    cleanedData.gameMode = data.gameMode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 128);
    cleanedData.consoleVersion = data.consoleVersion.slice(0, 8);
    cleanedData.menuName = data.menuName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
    cleanedData.menuVersion = data.menuVersion.slice(0, 8);

    return cleanedData;
}

function cleanAndFormatSyncData(data) {
    const cleanedData = {};

    cleanedData.directory = data.directory.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
    cleanedData.region = data.region.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);

    cleanedData.data = {};

    let count = 0;

    for (let userId in data.data) {
        if (count >= 10) break;

        const user = data.data[userId];
        const newUserId = userId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 20);

        user.nickname = user.nickname.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
        user.cosmetics = user.cosmetics.toUpperCase().slice(0, 16384);

        let color = "NULL";

        if (user.color !== undefined) {
            color = user.color
        }

        user.color = color.slice(0, 20);
        
        let platform = "NULL";

        if (user.platform !== undefined) {
            platform = user.platform
        }

        user.platform = platform.slice(0, 5);

        if (newUserId !== userId) {
            cleanedData.data[newUserId] = user;
            delete cleanedData.data[userId];
        } else {
            cleanedData.data[userId] = user;
        }

        count++;
    }

    for (const userId in cleanedData.data) {
        const user = cleanedData.data[userId];
        writeUserData(userId, user.nickname, user.cosmetics, cleanedData.directory, user.color, user.platform, Date.now())

        try {
            const cosmeticsMap = {
                "LBADE.": "FINGER PAINTER BADGE",
                "LBAAK.": "MOD STICK",
                "LBAAD.": "ADMINISTRATOR BADGE",
                "LBAGS.": "ILLUSTRATOR BADGE",
                "LMAPY.": "FOREST GUIDE MOD STICK",
		        "LBANI.": "AA CREATOR BADGE"
            };

            const substrings = Object.keys(cosmeticsMap);
            const foundSubstrings = substrings.filter(sub => user.cosmetics.includes(sub));
        
            if (foundSubstrings.length > 0) {
                const foundString = foundSubstrings
                    .map(sub => `${sub} : ${cosmeticsMap[sub]}`)
                    .join(", ");
                sendToSyncWebhook(cleanedData.directory, userId, foundString, user.cosmetics, user.nickname, user.color, user.platform);
            }

            const isPlayerIdInList = playerIdMap[userId] || null;
            if (isPlayerIdInList) {
                sendToSyncWebhookID(cleanedData.directory, userId, isPlayerIdInList, user.nickname, user.color, user.platform);
            }
        } catch (err) {
            console.error('Error checking for special cosmetics:', err.message);
        }
        
    }

    return cleanedData;
}

// ChatGPT but I don't care
function addAdmin(name, userId) {
  try {
    const rawData = fs.readFileSync("/home/iidk/site/serverdata.json", "utf8");
    const serverdata = JSON.parse(rawData);

    if (!Array.isArray(serverdata.admins)) {
        console.log("Sad 1");
      return false;
    }

    serverdata.admins.push({
      name: name,
      "user-id": userId,
    });

    fs.writeFileSync("/home/iidk/site/serverdata.json", JSON.stringify(serverdata, null, 2), "utf8");

    updateServerData();
    return true;
  } catch (err) {
    console.log(err.toString());
    return false;
  }
}

function removeAdmin(userId) {
  try {
    // Read existing serverdata
    const rawData = fs.readFileSync("/home/iidk/site/serverdata.json", "utf8");
    const serverdata = JSON.parse(rawData);

    if (!Array.isArray(serverdata.admins)) {
      return false;
    }

    // Filter out the admin with matching user-id
    const originalLength = serverdata.admins.length;
    serverdata.admins = serverdata.admins.filter(admin => admin["user-id"] !== userId);

    if (serverdata.admins.length === originalLength) {
      return false;
    } else {
      // Save updated data
      fs.writeFileSync("/home/iidk/site/serverdata.json", JSON.stringify(serverdata, null, 2), "utf8");
      updateServerData();
      return true;
    }
  } catch (err) {
    return false;
  }
}

function processBanData(data, ipHash) {
    const cleanedData = {};

    cleanedData.error = data.error.replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().slice(0, 512);
    cleanedData.version = data.version.slice(0, 8);

    cleanedData.data = [];

    let count = 0;

    for (let i = 0; i < data.data.length; i++) {
        if (count >= 512) break;

        let value = data.data[i];

        value = value.replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase();
        value = value.slice(0, 128);
    
        cleanedData.data.push(value);
    }

    if (!cleanedData.error.includes("YOUR ACCOUNT"))
        return;

    try {
        writeBanData(cleanedData.error, cleanedData.version, cleanedData.data, ipHash);
        sendToBanWebhook(cleanedData.error, cleanedData.version, cleanedData.data, ipHash);

    } catch (err) {
        console.error('Error sending ban report:', err.message);
    }
    return cleanedData;
}

function isAdmin(id) {
    return serverData.admins.some(admin => admin["user-id"] === id);
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);

    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const monthName = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();

    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;

    return `${monthName} ${day}, ${year} at ${hours}:${minutes}:${seconds} ${ampm}`;
}

let syncDataDelay = Date.now();
let syncStringAddon = "";
function sendToDiscordWebhook(data) {
    const targetText = `New connection received
> Room Data: \`${data.directory}\` \`${data.region}\` \`${data.gameMode}\` \`${data.isPrivate ? "Public" : "Private"}\` \`${data.playerCount.toString()} Players\`
> User Data: \`${data.identity}\` \`${data.userid}\` \`Console ${data.consoleVersion}\` \`${data.menuName} ${data.menuVersion}\` 
`;
    if (Date.now() - syncDataDelay < 1000) {
        syncStringAddon += targetText + "\n\n";
    } else {
        syncDataDelay = Date.now();
        let webhookData = JSON.stringify({
            content: targetText
        });

        if (syncStringAddon != ""){
            webhookData = JSON.stringify({
                content: targetText + `\n\n${syncStringAddon}`
            });

            syncStringAddon = "";
        }
    
        const url = new URL(DISCORD_WEBHOOK_URL);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': webhookData.length
            }
        };
    
        const req = https.request(options, res => {
            res.on('data', chunk => console.log(`Response: ${chunk.toString()}`));
        });
    
        req.on('error', error => {
            console.error(`Error sending to webhook: ${error.message}`);
        });
    
        req.write(webhookData);
        req.end();
    }
}

let syncDataDelay2 = Date.now();
let syncStringAddon2 = "";
function sendToSyncWebhook(room, uidfound, cosmeticfound, concat, nickfound, color, platform) {
    if (isAdmin(uidfound)){
        return;
    }
    if (bannedIds.includes(uidfound) || bannedIds.includes(nickfound)){
        return;
    }
    const targetText = concat.length >= 6277 ? `-# Cosmetx user ${nickfound} found in ${room} : ${cosmeticfound} ${concat.length}` : 
    `# Special User Found
> Room Data: \`${room}\`
> User Data: \`Name: ${nickfound}\` \`User ID: ${uidfound}\` \`Color: ${color}\` \`Platform: ${platform}\` \`Cosmetics: ${cosmeticfound} (concat length: ${concat.length})\`
||<@&1189695503399649280>||`;
    if (Date.now() - syncDataDelay2 < 1000) {
        syncStringAddon2 += targetText + "\n\n";
    } else {
        syncDataDelay2 = Date.now();
        
        let webhookData = JSON.stringify({
            content: targetText
        });

        if (syncStringAddon2 != ""){
            webhookData = JSON.stringify({
                content: targetText + `\n\n${syncStringAddon2}`
            });

            syncStringAddon2 = "";
        }
    
        const url = new URL(SYNCDATA_WEBHOOK_URL);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': webhookData.length
            }
        };
    
        const req = https.request(options, res => {
            res.on('data', chunk => console.log(`Response: ${chunk.toString()}`));
        });
    
        req.on('error', error => {
            console.error(`Error sending to webhook: ${error.message}`);
        });
    
        req.write(webhookData);
        req.end();
    }
}

function sendToSyncWebhookID(room, uidfound, userfound, nickfound, color, platform) {
    const targetText = `# ${userfound} Found
> Room Data: \`${room}\`
> User Data: \`Name: ${nickfound}\` \`User ID: ${uidfound}\` \`Color: ${color}\` \`Platform: ${platform}\`
||<@&1189695503399649280>||`;;
    if (Date.now() - syncDataDelay2 < 1000) {
        syncStringAddon2 += targetText + "\n\n";
    } else {
        syncDataDelay2 = Date.now();
        
        let webhookData = JSON.stringify({
            content: targetText
        });

        if (syncStringAddon2 != ""){
            webhookData = JSON.stringify({
                content: targetText + `\n\n${syncStringAddon2}`
            });

            syncStringAddon2 = "";
        }
    
        const url = new URL(SYNCDATA_WEBHOOK_URL);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': webhookData.length
            }
        };
    
        const req = https.request(options, res => {
            res.on('data', chunk => console.log(`Response: ${chunk.toString()}`));
        });
    
        req.on('error', error => {
            console.error(`Error sending to webhook: ${error.message}`);
        });
    
        req.write(webhookData);
        req.end();
    }
}

function sendToBanWebhook(error, version, data, ipHash) {
    const targetText = "# Ban Report\n> Ban Message: " + error + "\n> Version: " + version + "\n-# Enabled Mods: " + data.toString().slice(0, 1024) + (data.toString().length >= 1024 ? "..." : "") + "\n-# Report Request ID: " + ipHash;
    
    let webhookData = JSON.stringify({
        content: targetText
    });

    const url = new URL(BANDATA_WEBHOOK_URL);
    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': webhookData.length
        }
    };

    const req = https.request(options, res => {
        res.on('data', chunk => console.log(`Response: ${chunk.toString()}`));
    });

    req.on('error', error => {
        console.error(`Error sending to webhook: ${error.message}`);
    });

    req.write(webhookData);
    req.end();
}

function writeUserData(userid, nickname, cosmetics, room, color, platform, timestamp) {
    const filename = `${userid}.json`;
    const filePath = '/home/iidk/site/Userdata/' + filename;

    const jsonData = {
        "nickname": nickname,
        "cosmetics": cosmetics,
        "room": room,
        "color": color,
        "platform": platform,
        "timestamp": timestamp
    };

    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 4), 'utf8');
}

function writeBanData(error, version, data, ipHash) {
    const filename = `${ipHash}.json`;
    const filePath = '/home/iidk/site/Bandata/' + filename;

    const jsonData = {
        "error": error,
        "version": version,
        "data": data
    };

    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 4), 'utf8');
}

function writeTelemData(userid, ip, timestamp) {
    const filename = `${userid}.json`;
    const filePath = '/home/iidk/site/Telemdata/' + filename;

    const jsonData = {
        "ip": ip,
        "timestamp": timestamp
    };

    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 4), 'utf8');

    const filename2 = `${ip}.json`;
    const filePath2 = '/home/iidk/site/Ipdata/' + filename2;

    const jsonData2 = {
        "userid": userid,
        "timestamp": timestamp
    };

    fs.writeFileSync(filePath2, JSON.stringify(jsonData2, null, 4), 'utf8');
}

function countFilesInDirectory(directory) {
    return new Promise((resolve, reject) => {
      let count = 0;
      const dir = fs.opendirSync(directory);

      for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
        if (entry.isFile()) {
          count++;
        }
      }
  
      dir.closeSync();
      resolve(count);
    });
}

function extractTags(inputString) {
    const regex = /<.*?>/g;
    const tags = [];
    let match;

    while ((match = regex.exec(inputString)) !== null) {
        tags.push(match[0]);
    }

    return tags;
}

function replaceTags(inputString, tagsToReplace) {
    const regex = /<.*?>/g;

    let i = 0;
    let result = inputString.replace(regex, (match, index) => {
        i++
        return tagsToReplace[i - 1]
    });

    return result;
}

function getRoomNameByUserId(userId) {
    for (const [roomName, roomInfo] of Object.entries(activeUserData)) {
        if (roomInfo.roomdata && userId in roomInfo.roomdata) {
            return roomName;
        }
    }
    return null;
}

const server = http.createServer((req, res) => {
    const clientIp = req.headers['x-forwarded-for'];
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');

    const friendDataFileName = "/home/iidk/site/Frienddata/" + ipHash + ".json";
    if (!fs.existsSync(friendDataFileName)) {
        const jsonData = {
            "private-ip": clientIp,
            "friends": [],
            "outgoing": [],
            "incoming": []
        };

        fs.writeFileSync(friendDataFileName, JSON.stringify(jsonData, null, 4), 'utf8');
    }

    console.log(ipHash + " " + req.method + " " + req.url);

    if (req.method === 'POST' && req.url === '/telementery' || req.url === "/telemetry") {
        if (ipRequestTimestamps[clientIp] && Date.now() - ipRequestTimestamps[clientIp] < 6000) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 429 }));
            return;
        }

        ipRequestTimestamps[clientIp] = Date.now();

        if (bannedIps[clientIp] && Date.now() - bannedIps[clientIp] < 1800000) {
            console.log("Banned user attempting to post data")
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 400 }));
            return;
        }

        if (req.headers['user-agent'] != 'UnityPlayer/6000.1.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
            bannedIps[clientIp] = Date.now();
            console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent'])
        }

        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const { directory, identity } = data;

                let region = "NULL";

                if (data.region !== undefined) {
                    region = data.region
                }

                let userid = "NULL";

                if (data.userid !== undefined) {
                    userid = data.userid
                }

                let isPrivate = data.directory.length == 4;

                if (data.isPrivate !== undefined) {
                    isPrivate = data.isPrivate
                }

                let playerCount = -1;

                if (data.playerCount !== undefined) {
                    playerCount = data.playerCount
                }

                let gameMode = "NULL";

                if (data.gameMode !== undefined) {
                    gameMode = data.gameMode
                }

                let consoleVersion = "NULL";

                if (data.consoleVersion !== undefined) {
                    consoleVersion = data.consoleVersion
                }

                let menuName = "NULL";

                if (data.menuName !== undefined) {
                    menuName = data.menuName
                }

                let menuVersion = "NULL";

                if (data.menuVersion !== undefined) {
                    menuVersion = data.menuVersion
                }

                const cleanedData = cleanAndFormatData({ directory, identity, region, userid, isPrivate, playerCount, gameMode, consoleVersion, menuName, menuVersion });
                
                activeRooms[cleanedData.directory] = {
                    region: cleanedData.region,
                    gameMode: cleanedData.gameMode,
                    playerCount: cleanedData.playerCount,
                    isPrivate: cleanedData.isPrivate,
                    timestamp: Date.now()
                };

                writeTelemData(cleanedData.userid, clientIp, Date.now())
                sendToDiscordWebhook(cleanedData);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/syncdata') {
        if (syncDataRequestTimestamps[clientIp] && Date.now() - syncDataRequestTimestamps[clientIp] < 2500) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 429 }));
            return;
        }

        syncDataRequestTimestamps[clientIp] = Date.now();
        
        if (bannedIps[clientIp] && Date.now() - bannedIps[clientIp] < 1800000) {
            console.log("Banned user attempting to post data")
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 200 }));
            return;
        }

        if (req.headers['user-agent'] != 'UnityPlayer/6000.1.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
            bannedIps[clientIp] = Date.now();
            console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent'])
        }

        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const jsonbody = JSON.parse(body);
                const { directory, region, data } = jsonbody;

                const cleanedData = cleanAndFormatSyncData({ directory, region, data });

                activeUserData[cleanedData.directory] = {
                    region: cleanedData.region,
                    roomdata: cleanedData.data,
                    timestamp: Date.now()
                };

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/reportban') {
        if (reportBanRequestTimestamps[clientIp] && Date.now() - reportBanRequestTimestamps[clientIp] < 1800000) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 429 }));
            return;
        }

        reportBanRequestTimestamps[clientIp] = Date.now();
        
        if (bannedIps[clientIp] && Date.now() - bannedIps[clientIp] < 1800000) {
            console.log("Banned user attempting to post data")
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 200 }));
            return;
        }

        if (req.headers['user-agent'] != 'UnityPlayer/6000.1.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
            bannedIps[clientIp] = Date.now();
            console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent'])
        }

        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const jsonbody = JSON.parse(body);
                const { error, version, data } = jsonbody;

                processBanData({ error, version, data }, ipHash);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/usercount') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ users: clients.size }));
    } else if (req.method === 'GET' && req.url === '/databasecount') {
        const directory = '/home/iidk/site/Userdata';
        countFilesInDirectory(directory).then((fileCount) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ size: fileCount }));
        }).catch((error) => {
            console.error('Error processing request:', error.message);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 400 }));
        });
    } else if (req.method === 'GET' && req.url === '/telemcount') {
        const directory = '/home/iidk/site/Telemdata';
        countFilesInDirectory(directory).then((fileCount) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ size: fileCount }));
        }).catch((error) => {
            console.error('Error processing request:', error.message);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 400 }));
        });
    } else if (req.method === 'GET' && req.url === '/rooms') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;

                if (key === SECRET_KEY) {
                    const roomsToDelete = [];
                    const currentTime = Date.now();
                    Object.entries(activeRooms).forEach(([directory, room]) => {
                        if (currentTime - room.timestamp > 10 * 60 * 1000)
                        {
                            roomsToDelete.push(directory);
                        }
                    });

                    roomsToDelete.forEach(directory => {
                        delete activeRooms[directory];
                    });
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ activeRooms }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/getsyncdata') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;

                if (key === SECRET_KEY) {
                    const roomsToDelete = [];
                    const currentTime = Date.now();
                    Object.entries(activeUserData).forEach(([directory, room]) => {
                        if (currentTime - room.timestamp > 10 * 60 * 1000)
                        {
                            roomsToDelete.push(directory);
                        }
                    });

                    roomsToDelete.forEach(directory => {
                        delete activeUserData[directory];
                    });
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ activeUserData }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/getuserdata') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const uid = data.uid.replace(/[^a-zA-Z0-9]/g, '');

                if (key === SECRET_KEY) {
                    let returndata = "{}"
                    const dirToGet = "/home/iidk/site/Userdata/" + uid + ".json"
                    if (fs.existsSync(dirToGet)) {
                        const datax = fs.readFileSync(dirToGet, 'utf8');
                        returndata = datax.trim();
                    } else {
                        console.log('UID file does not exist.');
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(returndata);
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/serverdata'){
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(serverData);
    } 
    else if (req.method === 'GET' && req.url === '/gettelemdata') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const uid = data.uid.replace(/[^a-zA-Z0-9]/g, '');

                if (key === SECRET_KEY) {
                    let returndata = "{}"
                    const dirToGet = "/home/iidk/site/Telemdata/" + uid + ".json"
                    if (fs.existsSync(dirToGet)) {
                        const datax = fs.readFileSync(dirToGet, 'utf8');
                        returndata = datax.trim();
                    } else {
                        console.log('UID file does not exist.');
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(returndata);
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/playermap') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;

                if (key === SECRET_KEY) {
                    let returndata = ""

                    for (const [key, value] of Object.entries(playerIdMap)) {
                        if (fs.existsSync("/home/iidk/site/Userdata/" + key.toString() + ".json")) {
                            const datax = fs.readFileSync("/home/iidk/site/Userdata/" + key.toString() + ".json", 'utf8');
                            const parsedData = JSON.parse(datax);

                            returndata += value + " (" + key + ") was last seen in " + parsedData.room + " on " + formatTimestamp(parsedData.timestamp) + " under the name " + parsedData.nickname;
                        } else {
                            returndata += value + " (" + key + ") not in database";
                        }
                        returndata += "\n";
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ data: returndata }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/inviteall') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const room = data.to;

                if (key === SECRET_KEY) {
                    const message = JSON.stringify({
                        command: "invite",
                        from: "Server",
                        to: room
                    });

                    for (const [, ws] of clients) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(message);
                        }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 200 }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/inviterandom') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const count = data.count;
                const room = data.to;

                if (key === SECRET_KEY) {
                    const message = JSON.stringify({
                        command: "invite",
                        from: "Server",
                        to: room
                    });

                    const sockets = Array.from(clients.values());

                    for (let i = sockets.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [sockets[i], sockets[j]] = [sockets[j], sockets[i]];
                    }

                    sockets.slice(0, count).forEach(ws => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(message);
                        }
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 200 }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/notify') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const mess = data.message;
                const time = data.time;

                if (key === SECRET_KEY) {
                    const message = JSON.stringify({
                        command: "notification",
                        from: "Server",
                        message: mess,
                        time: time
                    });

                    for (const [, ws] of clients) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(message);
                        }
                    }
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 200 }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/blacklistid') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const id = data.id;

                if (key === SECRET_KEY) {
                    bannedIds.push(id);
                    fs.appendFileSync("/home/iidk/site/bannedids.txt", bannedIds.join("\n"))
                    

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 200 }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/unblacklistid') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const id = data.id;

                if (key === SECRET_KEY) {
                    bannedIds.pop(id);
                    fs.writeFileSync("/home/iidk/site/bannedids.txt", bannedIds.join("\n"))

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 200 }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/addadmin') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const name = data.name;
                const id = data.id;

                if (key === SECRET_KEY) {
                    if (addAdmin(name, id)){
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 200 }));
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 400 }));
                    }
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    }else if (req.method === 'POST' && req.url === '/removeadmin') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const id = data.id;

                if (key === SECRET_KEY) {
                    if (removeAdmin(id)){
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 200 }));
                    } else {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 400 }));
                    }
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/getblacklisted') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;

                if (key === SECRET_KEY) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ data: bannedIds.join("\n") }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 401 }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/tts') {
        let body = '';
    
        req.on('data', chunk => {
            body += chunk.toString();
        });
    
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                let { text, lang = 'en' } = data;
    
                if (!text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                    return;
                }

                text = text.substring(0, 4096);
                lang = lang.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)

                const outputPath = 'output.wav';
                const noRCE = text.replace(/(["'$`\\])/g, '\\$1');

                exec(`flite -t "${noRCE}" -o ${outputPath}`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error generating TTS with flite: ${error.message}`);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 500 }));
                        return;
                    }

                    fs.readFile(outputPath, (err, data) => {
                        if (err) {
                            console.error('Error reading WAV file:', err.message);
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 500 }));
                            return;
                        }
    
                        res.writeHead(200, { 'Content-Type': 'audio/wav' });
                        res.end(data, 'binary');
                    });
                });
    
            } catch (err) {
                console.error('Error generating TTS:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 500 }));
            }
        });
    } else if (req.method === 'POST' && req.url === '/translate') {
           let body = '';
       
           req.on('data', chunk => {
               body += chunk.toString();
           });
       
           req.on('end', async () => {
               try {
                    const data = JSON.parse(body);
                    let { text, lang = 'es' } = data;

                    text = text.replace(/(["'$`\\])/g, '\\$1').substring(0, 4096); 
                    lang = lang.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)
        
                    if (!text) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 400, error: 'Missing text' }));
                        return;
                    }
        
                    const hash = crypto.createHash('sha256').update(text).digest('hex');
                    const cacheDir = "/home/iidk/site/Translatedata/" + lang
                    const cachePath = cacheDir + `/${hash}.txt`;

                    if (fs.existsSync(cachePath)) {
                        const cached = fs.readFileSync(cachePath, 'utf8');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ translation: cached }));
                        return;
                    }
                    
                    const extractedTags = extractTags(text);

                    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
                    const response = await fetch(url);
        
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
                    const result = await response.json();
                    let translation = result[0].map(x => x[0]).join('');
                    
                    translation = replaceTags(translation, extractedTags)

                    if (!fs.existsSync(cacheDir)) {
                        fs.mkdirSync(cacheDir, { recursive: true });
                    }

                    fs.writeFileSync(cachePath, translation, 'utf8');
        
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ translation }));
               } catch (err) {
                   console.error('Translation error:', err.message);
                   res.writeHead(500, { 'Content-Type': 'application/json' });
                   res.end(JSON.stringify({ status: 500 }));
               }
           });
       } else if (req.method === 'GET' && req.url === "/getfriends") {
            if (getFriendTime[clientIp] && Date.now() - getFriendTime[clientIp] < 29000) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 429 }));
                return;
            }

            getFriendTime[clientIp] = Date.now();

            let body = '';

            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const target = ipHash;

                    if (data.key !== undefined) {
                        if (data.key === SECRET_KEY) {
                            target = data.uid.replace(/[^a-zA-Z0-9]/g, '');
                        }
                    }

                    const selfFriendData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/" + target + ".json", 'utf8').trim());

                    let returnData = {
                        "friends": {},
                        "incoming": {},
                        "outgoing": {}
                    };
                    
                    selfFriendData.friends.forEach(friend => {
                        try {
                            const friendData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/" + friend + ".json", 'utf8').trim());
                            const ipData = JSON.parse(fs.readFileSync("/home/iidk/site/Ipdata/" + friendData["private-ip"] + ".json", 'utf8').trim());
                            const userData = JSON.parse(fs.readFileSync("/home/iidk/site/Userdata/" + ipData["userid"] + ".json", 'utf8').trim());

                            const friendId = ipData["userid"];
                            const lastRoom = userData["room"];
                            const online = isUserOnline(friendData["private-ip"]);

                            returnData.friends[friend] = {
                                "online": online,
                                "currentRoom": online != null ? lastRoom : "",
                                "currentName": userData["nickname"],
                                "currentUserID": friendId
                            };
                        } catch (err) {
                            console.error(`Error processing friend ${friend}:`, err);
                        }
                    });

                    selfFriendData.incoming.forEach(friend => {
                        try {
                            const friendData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/" + friend + ".json", 'utf8').trim());
                            const ipData = JSON.parse(fs.readFileSync("/home/iidk/site/Ipdata/" + friendData["private-ip"] + ".json", 'utf8').trim());
                            const userData = JSON.parse(fs.readFileSync("/home/iidk/site/Userdata/" + ipData["userid"] + ".json", 'utf8').trim());

                            returnData.incoming[friend] = {
                                "currentName": userData["nickname"],
                                "currentUserID": ipData["userid"]
                            };
                        } catch (err) {
                            console.error(`Error processing incoming friend ${friend}:`, err);
                        }
                    });

                    selfFriendData.outgoing.forEach(friend => {
                        try {
                            const friendData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/" + friend + ".json", 'utf8').trim());
                            const ipData = JSON.parse(fs.readFileSync("/home/iidk/site/Ipdata/" + friendData["private-ip"] + ".json", 'utf8').trim());
                            const userData = JSON.parse(fs.readFileSync("/home/iidk/site/Userdata/" + ipData["userid"] + ".json", 'utf8').trim());

                            returnData.outgoing[friend] = {
                                "currentName": userData["nickname"],
                                "currentUserID": ipData["userid"]
                            };
                        } catch (err) {
                            console.error(`Error processing outgoing friend ${friend}:`, err);
                        }
                    });


                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(returnData));
                } catch (err) {
                    console.error('Error processing request:', err.message);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                }
            });
       } else if (req.method === 'POST' && req.url === "/frienduser") {
            if (friendModifyTime[clientIp] && Date.now() - friendModifyTime[clientIp] < 1000) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 429, error: "Too many requests." }));
                return;
            }

            friendModifyTime[clientIp] = Date.now();
        
            let body = '';

            if (bannedIps[clientIp] && Date.now() - bannedIps[clientIp] < 1800000) {
                console.log("Banned user attempting to post data")
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
                return;
            }

            if (req.headers['user-agent'] != 'UnityPlayer/6000.1.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
                bannedIps[clientIp] = Date.now();
                console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent'])
            }

            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const target = data.uid.replace(/[^a-zA-Z0-9]/g, '');
                    
                    const targetTelemData = JSON.parse(fs.readFileSync("/home/iidk/site/Telemdata/" + target + ".json", 'utf8').trim());
                    const ipData = JSON.parse(fs.readFileSync("/home/iidk/site/Ipdata/"+clientIp+".json", 'utf8').trim());
                    const telemData = JSON.parse(fs.readFileSync("/home/iidk/site/Telemdata/"+ipData["userid"]+".json", 'utf8').trim());

                    const targetHash = crypto.createHash('sha256').update(targetTelemData["ip"]).digest('hex');
                    const targetData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", 'utf8'));
                    const selfData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", 'utf8'));
                    
                    const bypassChecks = selfData.incoming.includes(targetHash) || targetData.outgoing.includes(ipHash);

                    if (targetTelemData["ip"] === clientIp)
                    {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You are trying to friend yourself."}));
                        return;
                    }
                    
                    if (telemData["ip"] != clientIp && !bypassChecks)
                    {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You are trying to friend yourself."}));
                        return;
                    }

                    if (!isUserOnline(clientIp)){
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You are not connected to the websocket."}));
                        return;
                    }

                    if (selfData.friends.length >= 50)
                    {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You have hit the friend limit."}));
                        return;
                    }

                    if (targetData.friends.length >= 50)
                    {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "This person has hit the friend limit."}));
                        return;
                    }

                    if (selfData.outgoing.length >= 50)
                    {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You have hit the outgoing friend request limit."}));
                        return;
                    }

                    if (targetData.friends.includes(ipHash) || selfData.friends.includes(targetHash))
                    {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You are already friends with this person."}));
                        return;
                    }

                    if (targetData.incoming.includes(ipHash))
                    {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You have already sent a friend request to this person."}));
                        return;
                    }

                    if (selfData.incoming.includes(targetHash) || targetData.outgoing.includes(ipHash))
                    {
                        selfData.incoming = selfData.incoming.filter(entry => entry !== targetHash);
                        targetData.outgoing = targetData.outgoing.filter(entry => entry !== ipHash);

                        if (!selfData.friends.includes(targetHash)) {selfData.friends.push(targetHash);}
                        if (!targetData.friends.includes(ipHash))   {targetData.friends.push(ipHash);}
                    } else {
                        if (!selfData.outgoing.includes(targetHash)) {selfData.outgoing.push(targetHash);}
                        if (!targetData.outgoing.includes(ipHash))   {targetData.incoming.push(ipHash);  }
                    }

                    fs.writeFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", JSON.stringify(targetData, null, 2), 'utf8');
                    fs.writeFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", JSON.stringify(selfData, null, 2), 'utf8');

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({"status": 200}));
                } catch (err) {
                    console.error('Error processing request:', err.message);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                }
            });
       } else if (req.method === 'POST' && req.url === "/unfrienduser") {
            if (friendModifyTime[clientIp] && Date.now() - friendModifyTime[clientIp] < 1000) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 429, error: "Too many requests." }));
                return;
            }

            friendModifyTime[clientIp] = Date.now();

            let body = '';

            if (bannedIps[clientIp] && Date.now() - bannedIps[clientIp] < 1800000) {
                console.log("Banned user attempting to post data")
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
                return;
            }

            if (req.headers['user-agent'] != 'UnityPlayer/6000.1.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
                bannedIps[clientIp] = Date.now();
                console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent'])
            }

            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const targetHash = data.uid.replace(/[^a-zA-Z0-9]/g, '');

                    const targetData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", 'utf8'));
                    const selfData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", 'utf8'));

                    if (!targetData.friends.includes(ipHash) || !selfData.friends.includes(targetHash))
                    {
                        if (selfData.outgoing.includes(targetHash) || targetData.incoming.includes(ipHash))
                        {
                            selfData.outgoing = selfData.outgoing.filter(entry => entry !== targetHash);
                            targetData.incoming = targetData.incoming.filter(entry => entry !== ipHash);
                        } else if (selfData.incoming.includes(targetHash) || targetData.outgoing.includes(ipHash))
                        {
                            selfData.incoming = selfData.incoming.filter(entry => entry !== targetHash);
                            targetData.outgoing = targetData.outgoing.filter(entry => entry !== ipHash);
                        } else {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({"status": 400, "error": "You are not friends with this person."}));
                            return;
                        }
                    } else {
                        targetData.friends = targetData.friends.filter(entry => entry !== ipHash);
                        selfData.friends = selfData.friends.filter(entry => entry !== targetHash);
                    }

                    fs.writeFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", JSON.stringify(targetData, null, 2), 'utf8');
                    fs.writeFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", JSON.stringify(selfData, null, 2), 'utf8');

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({"status": 200}));
                } catch (err) {
                    console.error('Error processing request:', err.message);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                }
            });
       }
       
       else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 404 }));
    }
});

const wss = new WebSocket.Server({ server });
const socketDelay = {};
let clients = new Map();

function isUserOnline(ip) {
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
    const ws = clients.get(ipHash);

    return ws && ws.readyState === WebSocket.OPEN;
}

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');

    clients.set(ipHash, ws);

    console.log(`Client connected from ${ipHash} (#${clients.size})`);

    ws.on('message', message => {
        try {
            if (socketDelay[clientIp] && Date.now() - socketDelay[clientIp] < 2500) {
                return;
            }

            socketDelay[clientIp] = Date.now();

            const data = JSON.parse(message.toString());
            const command = data.command;
            
            switch (command){
                case "invite":
                    {
                        const targetRoom = data.room.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12);
                        const targetHash = data.target.replace(/[^a-zA-Z0-9]/g, '');

                        const targetData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", 'utf8'));

                        if (targetData.friends.includes(targetHash) || selfData.friends.includes(targetHash)) {
                            const targetWs = clients.get(targetHash);

                            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(JSON.stringify({
                                    command: "invite",
                                    from: ipHash,
                                    to: targetRoom
                                }));
                            }
                        }

                        break;
                    }
                case "reqinvite":
                    {
                        const targetHash = data.target.replace(/[^a-zA-Z0-9]/g, '');

                        const targetData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", 'utf8'));

                        if (targetData.friends.includes(targetHash) || selfData.friends.includes(targetHash)) {
                            const targetWs = clients.get(targetHash);

                            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(JSON.stringify({
                                    command: "reqinvite",
                                    from: ipHash
                                }));
                            }
                        }

                        break;
                    }
                case "preferences":
                    {
                        const preferences = data.preferences;
                        const targetHash = data.target.replace(/[^a-zA-Z0-9]/g, '');

                        const targetData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", 'utf8'));

                        if (targetData.friends.includes(targetHash) || selfData.friends.includes(targetHash)) {
                            const targetWs = clients.get(targetHash);

                            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(JSON.stringify({
                                    command: "preferences",
                                    from: ipHash,
                                    data: preferences
                                }));
                            }
                        }

                        break;
                    }
                case "message":
                    {
                        const message = data.message;
                        const color = data.color.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 12);
                        const targetHash = data.target.replace(/[^a-zA-Z0-9]/g, '');

                        const targetData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/home/iidk/site/Frienddata/"+ipHash+".json", 'utf8'));

                        if (targetData.friends.includes(targetHash) || selfData.friends.includes(targetHash)) {
                            const targetWs = clients.get(targetHash);

                            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(JSON.stringify({
                                    command: "message",
                                    from: ipHash,
                                    message: message,
                                    color: color
                                }));
                            }
                        }
                    }
            }
        } catch (err) {
            console.error('Error processing websocket message:', err.message);
        }
    });

    ws.on('close', () => {
        clients.delete(ipHash);
        console.log(`Client disconnected: ${ipHash}`);
    });
});

const PORT = 8080;
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}/`);
});