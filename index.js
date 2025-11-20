// Fun fact: going through 3.6 million JSON files and putting them in a SQLLite database is not friendly on the SD card you run it on.
// I moved all important data to a backup. It's failing slowly, I don't feel like getting a new one and no other important data is on it anyways.

const http = require('http');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const crypto = require('crypto');
const { exec } = require('child_process');
const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("/mnt/external/site-data/records.db");

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

let HASH_KEY = '';
if (fs.existsSync('/home/iidk/site/hashsecret.txt')) {
    HASH_KEY = fs.readFileSync('/home/iidk/site/hashsecret.txt', 'utf8').trim();
    console.log('Set hash');
} else {
    console.log('Hash file does not exist.');
}

const filePath = '/home/iidk/site/votes.json';

let votes = '{"a-votes":[],"b-votes":[]}';
if (fs.existsSync(filePath)) {
    votes = fs.readFileSync(filePath, 'utf8').trim();
    console.log('Set votes');
} else {
    console.log('Votes file does not exist, initializing.');
}

let votesObj;
try {
  votesObj = JSON.parse(votes);
} catch (e) {
  console.error('Error parsing votes.json, resetting to defaults.');
  votesObj = { "a-votes": [], "b-votes": [] };
}

function incrementVote(option, userId) {
  if (option !== 'a-votes' && option !== 'b-votes') {
    throw new Error('Must be "a-votes" or "b-votes"');
  }

  if (votesObj['a-votes'].includes(userId) || votesObj['b-votes'].includes(userId)) {
    console.log(`User ${userId} has already voted.`);
    return false;
  }

  votesObj[option].push(userId);

  fs.writeFileSync(filePath, JSON.stringify(votesObj, null, 2), 'utf8');
  console.log(`User ${userId} voted for ${option}`);
  return true;
}

function resetVotes() {
  votesObj = { "a-votes": [], "b-votes": [] };
  fs.writeFileSync(filePath, JSON.stringify(votesObj, null, 2), 'utf8');
  console.log('Votes have been reset');
}

function getVoteCounts() {
  return JSON.stringify({
    "a-votes": votesObj["a-votes"].length,
    "b-votes": votesObj["b-votes"].length
  });
}

function hashIpAddr(ip) {
  const h = crypto.createHmac('sha256', HASH_KEY).update(ip).digest();
  return h.toString('hex');
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

    console.log('Loaded banned ids');
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

function setPoll(poll, a, b) {
  try {
    const rawData = fs.readFileSync("/home/iidk/site/serverdata.json", "utf8");
    const serverdata = JSON.parse(rawData);

    serverdata.poll = poll;
    serverdata["option-a"] = a;
    serverdata["option-b"] = b;

    fs.writeFileSync("/home/iidk/site/serverdata.json", JSON.stringify(serverdata, null, 2), "utf8");

    updateServerData();
    resetVotes();
    return true;
  } catch (err) {
    console.log(err.toString());
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
    try {
        return Array.isArray(serverData?.admins) &&
           serverData.admins.some(admin => admin["user-id"] === id);
    } catch {
        return false;
    }
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

// Cache array to store up to 500 records
const recordCache = [];
const MAX_CACHE_SIZE = 500;

function writeRecordAutoRaw(id, nickname, room, cosmetics, color = null, platform = null, timestamp = null) {
    if (!timestamp) timestamp = Date.now();

    // Prepare record object
    const record = { id, nickname, room, cosmetics, color, platform, timestamp };
    record.raw_json = JSON.stringify(record);

    // Add to cache
    recordCache.push(record);

    // If cache reaches MAX_CACHE_SIZE, flush to DB
    if (recordCache.length >= MAX_CACHE_SIZE) {
        const cacheToFlush = recordCache.splice(0, recordCache.length); // clear immediately
        flushCacheToDB(cacheToFlush);
    }
}

// Function to flush cache to DB
function flushCacheToDB(records) {
    if (!records || records.length === 0) return;

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(`
            INSERT INTO records
            (id, nickname, room, cosmetics, color, platform, timestamp, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id, room) DO UPDATE SET
                nickname = excluded.nickname,
                cosmetics = excluded.cosmetics,
                color = excluded.color,
                platform = excluded.platform,
                timestamp = excluded.timestamp,
                raw_json = excluded.raw_json
        `);

        for (const r of records) {
            stmt.run([r.id, r.nickname, r.room, r.cosmetics, r.color, r.platform, r.timestamp, r.raw_json]);
        }

        stmt.finalize();
        db.run("COMMIT", (err) => {
            if (err) console.error("SQLite commit error:", err.message);
            else console.log(`Flushed ${records.length} records to the database.`);
        });
    });
}

// Optional: flush any remaining records before exit
process.on('exit', flushCacheToDB);
process.on('SIGINT', () => { flushCacheToDB(); process.exit(); });
process.on('SIGTERM', () => { flushCacheToDB(); process.exit(); });

const cache = {}; // { [id]: { timestamp: number, data: any } }
const CACHE_TTL = 60 * 1000; // 60 seconds in milliseconds

function getLatestRecordById(id, callback) {
    const now = Date.now();

    // Check cache first
    if (cache[id] && (now - cache[id].timestamp < CACHE_TTL)) {
        return callback(cache[id].data);
    }

    // If not cached or expired, query the database
    const sql = `
        SELECT raw_json
        FROM records
        WHERE id = ?
        ORDER BY timestamp DESC
        LIMIT 1
    `;

    db.get(sql, [id], (err, row) => {
        if (err) {
            console.error("SQLite error:", err.message);
            return callback(null);
        }

        if (!row) {
            return callback(null); // no records found
        }

        try {
            const parsed = JSON.parse(row.raw_json);

            // Update cache
            cache[id] = {
                timestamp: Date.now(),
                data: parsed
            };

            callback(parsed);
        } catch (e) {
            console.error("Failed to parse raw_json:", e.message);
            callback(null);
        }
    });
}

function getLatestRecordsByIds(ids, callback) {
    const now = Date.now();
    const results = {};
    const idsToQuery = [];

    // First, check the cache
    ids.forEach(id => {
        if (cache[id] && (now - cache[id].timestamp < CACHE_TTL)) {
            results[id] = cache[id].data;
        } else {
            idsToQuery.push(id);
        }
    });

    if (idsToQuery.length === 0) {
        // All data came from cache
        return callback(results);
    }

    // Construct placeholders for SQL IN clause
    const placeholders = idsToQuery.map(() => '?').join(',');

    // SQL to get the latest record per id
    const sql = `
        SELECT r1.id, r1.raw_json
        FROM records r1
        INNER JOIN (
            SELECT id, MAX(timestamp) AS max_ts
            FROM records
            WHERE id IN (${placeholders})
            GROUP BY id
        ) r2
        ON r1.id = r2.id AND r1.timestamp = r2.max_ts
    `;

    db.all(sql, idsToQuery, (err, rows) => {
        if (err) {
            console.error("SQLite error:", err.message);
            // Fill queried IDs with null
            idsToQuery.forEach(id => results[id] = null);
            return callback(results);
        }

        // Parse JSON and update cache
        rows.forEach(row => {
            try {
                const parsed = JSON.parse(row.raw_json);
                results[row.id] = parsed;

                cache[row.id] = {
                    timestamp: Date.now(),
                    data: parsed
                };
            } catch (e) {
                console.error("Failed to parse raw_json for id", row.id, e.message);
                results[row.id] = null;
            }
        });

        // Ensure any IDs with no records are set to null
        idsToQuery.forEach(id => {
            if (!(id in results)) results[id] = null;
        });

        callback(results);
    });
}


// Old, migrated to sqllite
function writeUserData(userid, nickname, cosmetics, room, color, platform, timestamp) {
    writeRecordAutoRaw(userid, nickname, room, cosmetics, color, platform, timestamp);
}

function writeBanData(error, version, data, ipHash) {
    /*
    const filename = `${ipHash}.json`;
    const filePath = '/mnt/external/site-data/Bandata/' + filename;

    const jsonData = {
        "error": error,
        "version": version,
        "data": data
    };

    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 4), 'utf8');
    */
   // Why are we doing this anyways? What a waste of storage
}

function writeTelemData(userid, ip, timestamp) {
    const filename = `${userid}.json`;
    const filePath = '/mnt/external/site-data/Telemdata/' + filename;

    const jsonData = {
        "ip": ip,
        "timestamp": timestamp
    };

    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 4), 'utf8');

    const filename2 = `${ip}.json`;
    const filePath2 = '/mnt/external/site-data/Ipdata/' + filename2;

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
    const ipHash = hashIpAddr(clientIp);

    const friendDataFileName = "/mnt/external/site-data/Frienddata/" + ipHash + ".json";
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

        if (req.headers['user-agent'] != 'UnityPlayer/6000.2.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
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

        if (req.headers['user-agent'] != 'UnityPlayer/6000.2.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
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

        if (req.headers['user-agent'] != 'UnityPlayer/6000.2.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
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
    } else if (req.method === 'GET' && req.url === '/telemcount') {
        const directory = '/mnt/external/site-data/Telemdata';
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
                    getLatestRecordById(uid, (data) => {
                        res.writeHead(200, { 'Content-Type': 'application/json' });

                        if (!data){
                            res.end("{}");
                        } else {
                            res.end(JSON.stringify(data));
                        }
                    });
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
                    const dirToGet = "/mnt/external/site-data/Telemdata/" + uid + ".json"
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
    } else if (req.method === 'POST' && req.url === '/vote') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const option = data.option;

                if (incrementVote(option, ipHash)){
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(getVoteCounts());
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: "You have already voted" }));
                }
            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/votes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(getVoteCounts());
    } else if (req.method === 'GET' && req.url === '/playermap') { // Shit
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const incoming = JSON.parse(body);
                const key = incoming.key;

                if (key !== SECRET_KEY) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 401 }));
                }

                let returndata = "";
                let pending = Object.keys(playerIdMap).length;

                if (pending === 0) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ data: "" }));
                }

                for (const [uid, displayName] of Object.entries(playerIdMap)) {
                    const cleanId = uid.replace(/[^a-zA-Z0-9]/g, '');

                    getLatestRecordById(cleanId, (record) => {
                        if (!record) {
                            returndata += `${displayName} (${cleanId}) not in database\n`;
                        } else {
                            returndata += `${displayName} (${cleanId}) was last seen in ${record.room ?? "??"} on ${formatTimestamp(record.timestamp)} under the name ${record.nickname ?? "??"}\n`;
                        }

                        pending--;

                        if (pending === 0) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ data: returndata }));
                        }
                    });
                }

            } catch (err) {
                console.error('Error processing request:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } else if (req.method === 'GET' && req.url === "/sql"){
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const incoming = JSON.parse(body);
                const key = incoming.key;

                if (key !== SECRET_KEY) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 401 }));
                }

                db.all(incoming.query, [], (err, rows) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ error: err.message }));
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 200, rows }));
                });
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
    } else if (req.method === 'POST' && req.url === '/removeadmin') {
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
    } else if (req.method === 'POST' && req.url === '/setpoll') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const key = data.key;
                const poll = data.poll;
                const a = data.a;
                const b = data.b;

                if (key === SECRET_KEY) {
                    if (setPoll(poll, a, b)){
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
        
                    const hash = hashIpAddr(text);
                    const cacheDir = "/mnt/external/site-data/Translatedata/" + lang
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
                    const data = (body !== undefined && body !== null) ? JSON.parse(body) : JSON.parse("{}");

                    let target = ipHash;

                    if (data.key !== undefined && data.key === SECRET_KEY) {
                        target = data.uid.replace(/[^a-zA-Z0-9]/g, '');
                    }

                    const selfFriendData = JSON.parse(fs.readFileSync(`/mnt/external/site-data/Frienddata/${target}.json`, 'utf8').trim());

                    let returnData = {
                        friends: {},
                        incoming: {},
                        outgoing: {}
                    };

                    const allIdsMap = {};

                    const processFriendArray = (array, type) => {
                        array.forEach(friend => {
                            try {
                                const friendData = JSON.parse(fs.readFileSync(`/mnt/external/site-data/Frienddata/${friend}.json`, 'utf8').trim());
                                const ipData = JSON.parse(fs.readFileSync(`/mnt/external/site-data/Ipdata/${friendData["private-ip"]}.json`, 'utf8').trim());
                                const userId = ipData["userid"];
                                allIdsMap[userId] = { source: type, friend };
                            } catch (err) {
                                console.error(`Error processing ${type} friend ${friend}:`, err);
                            }
                        });
                    };

                    processFriendArray(selfFriendData.friends, "friends");
                    processFriendArray(selfFriendData.incoming, "incoming");
                    processFriendArray(selfFriendData.outgoing, "outgoing");

                    const allIds = Object.keys(allIdsMap);

                    if (allIds.length <= 0)
                    {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(returnData));
                        return;
                    }

                    getLatestRecordsByIds(allIds, (results) => {
                        Object.entries(results).forEach(([id, record]) => {
                            const { source, friend } = allIdsMap[id]; // source: 'friends', 'incoming', 'outgoing'
                            switch (source){
                                case "friends":
                                {
                                    const online = isUserOnline(friend);
                                    returnData.friends[friend] = {
                                        "online": online,
                                        "currentRoom": online != null ? record["room"] : "",
                                        "currentName": record["nickname"],
                                        "currentUserID": record["id"]
                                    };
                                    break;
                                }
                                case "incoming":
                                {
                                    returnData.incoming[friend] = {
                                        "currentName": record["nickname"],
                                        "currentUserID": record["id"]
                                    };
                                    break;
                                }
                                case "outgoing":
                                {
                                    returnData.outgoing[friend] = {
                                        "currentName": record["nickname"],
                                        "currentUserID": record["id"]
                                    };
                                    break;
                                }
                            }
                        });

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(returnData));
                    });
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

            if (req.headers['user-agent'] != 'UnityPlayer/6000.2.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
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
                    
                    const targetTelemData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Telemdata/" + target + ".json", 'utf8').trim());
                    const ipData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Ipdata/"+clientIp+".json", 'utf8').trim());
                    const telemData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Telemdata/"+ipData["userid"]+".json", 'utf8').trim());

                    const targetHash = hashIpAddr(targetTelemData["ip"]);
                    const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                    const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));
                    
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

                    fs.writeFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", JSON.stringify(targetData, null, 2), 'utf8');
                    fs.writeFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", JSON.stringify(selfData, null, 2), 'utf8');

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

            if (req.headers['user-agent'] != 'UnityPlayer/6000.2.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)') {
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

                    const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                    const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));

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

                    fs.writeFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", JSON.stringify(targetData, null, 2), 'utf8');
                    fs.writeFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", JSON.stringify(selfData, null, 2), 'utf8');

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({"status": 200}));
                } catch (err) {
                    console.error('Error processing request:', err.message);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                }
            });
       }
       else if (req.method === 'GET' && (req.url === "/" || req.url === ""))
       {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 200, message: "This is an API. You can not view it like a website. Check out https://github.com/iiDk-the-actual/iidk.online for more info."}));
       }
       else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 404 }));
       
        }
});

const wss = new WebSocket.Server({ server });
const socketDelay = {};
let clients = new Map();

const joinDelay = {};

function isUserOnline(ip) {
    const ipHash = hashIpAddr(ip);
    const ws = clients.get(ipHash);

    return ws && ws.readyState === WebSocket.OPEN;
}

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const ipHash = hashIpAddr(clientIp);

    if (joinDelay[clientIp] && Date.now() - joinDelay[clientIp] < 10000){
        console.log(`Blocked ${ipHash} for mass`);
        wss.close(1008, "Wait before reconnecting to websocket");
        return;
    }
    joinDelay[clientIp] = Date.now();

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

                        const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));

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

                        const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));

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

                        const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));

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
                case "theme":
                    {
                        const theme = data.theme;
                        const targetHash = data.target.replace(/[^a-zA-Z0-9]/g, '');

                        const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));

                        if (targetData.friends.includes(targetHash) || selfData.friends.includes(targetHash)) {
                            const targetWs = clients.get(targetHash);

                            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(JSON.stringify({
                                    command: "theme",
                                    from: ipHash,
                                    data: theme
                                }));
                            }
                        }

                        break;
                    }
                case "macro":
                    {
                        const macro = data.macro;
                        const targetHash = data.target.replace(/[^a-zA-Z0-9]/g, '');

                        const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));

                        if (targetData.friends.includes(targetHash) || selfData.friends.includes(targetHash)) {
                            const targetWs = clients.get(targetHash);

                            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                targetWs.send(JSON.stringify({
                                    command: "macro",
                                    from: ipHash,
                                    data: macro
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

                        const targetData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+targetHash+".json", 'utf8'));
                        const selfData = JSON.parse(fs.readFileSync("/mnt/external/site-data/Frienddata/"+ipHash+".json", 'utf8'));

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
