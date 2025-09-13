// iidk.online
// Server for ii's Stupid Menu and related projects

// I wrote the script originally but rage quit on how it was set up and had deepseek rewrite the entire thing

const http = require('http');
const https = require('https');
const fs = require('fs').promises;
const WebSocket = require('ws');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');

// Configuration
const CONFIG = {
    PORT: 8080,
    BASE_PATH: '/home/iidk/site',
    RATE_LIMITS: {
        TELEMETRY: 6000,
        SYNC_DATA: 2500,
        REPORT_BAN: 1800000,
        FRIEND_GET: 29000,
        FRIEND_MODIFY: 1000,
        SOCKET: 2500,
        BAN_DURATION: 1800000
    },
    VALIDATION: {
        USER_AGENT: 'UnityPlayer/6000.1.9f1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)'
    }
};

// In-memory caches
const caches = {
    bannedIds: new Set(),
    playerIdMap: new Map(),
    ipRequestTimestamps: new Map(),
    syncDataRequestTimestamps: new Map(),
    reportBanRequestTimestamps: new Map(),
    getFriendTime: new Map(),
    friendModifyTime: new Map(),
    bannedIps: new Map(),
    activeRooms: new Map(),
    activeUserData: new Map(),
    clients: new Map()
};

// Configuration files
const configFiles = {
    webhook: 'webhook.txt',
    syncwebhook: 'syncwebhook.txt',
    banwebhook: 'banwebhook.txt',
    secret: 'secret.txt',
    serverdata: 'serverdata.json',
    playerids: 'playerids.txt',
    bannedids: 'bannedids.txt'
};

let serverData = '{"error":"No data"}';
let DISCORD_WEBHOOK_URL = '';
let SYNCDATA_WEBHOOK_URL = '';
let BANDATA_WEBHOOK_URL = '';
let SECRET_KEY = '';

// Initialize the server
async function initializeServer() {
    try {
        // Load configuration files
        await loadConfigFiles();
        
        // Load data files
        await loadDataFiles();
        
        console.log('Server initialization complete');
    } catch (error) {
        console.error('Failed to initialize server:', error);
        process.exit(1);
    }
}

async function loadConfigFiles() {
    const configPromises = Object.entries(configFiles).map(async ([key, filename]) => {
        try {
            const filePath = path.join(CONFIG.BASE_PATH, filename);
            const content = await fs.readFile(filePath, 'utf8');
            
            switch (key) {
                case 'webhook':
                    DISCORD_WEBHOOK_URL = content.trim();
                    break;
                case 'syncwebhook':
                    SYNCDATA_WEBHOOK_URL = content.trim();
                    break;
                case 'banwebhook':
                    BANDATA_WEBHOOK_URL = content.trim();
                    break;
                case 'secret':
                    SECRET_KEY = content.trim();
                    break;
                case 'serverdata':
                    serverData = content.trim();
                    break;
            }
            
            console.log(`Loaded ${key}`);
        } catch (error) {
            if (key !== 'serverdata') {
                console.log(`${filename} does not exist.`);
            }
        }
    });
    
    await Promise.all(configPromises);
}

async function loadDataFiles() {
    try {
        // Load player IDs
        const playerIdsPath = path.join(CONFIG.BASE_PATH, configFiles.playerids);
        const playerIdsContent = await fs.readFile(playerIdsPath, 'utf8');
        const lines = playerIdsContent.trim().split('\n');
        
        lines.forEach(line => {
            const [id, name] = line.split(';');
            if (id && name) {
                caches.playerIdMap.set(id.trim(), name.trim());
            }
        });
        
        console.log('Loaded playerIdMap');
    } catch (error) {
        console.log('Player IDs file does not exist.');
    }
    
    try {
        // Load banned IDs
        const bannedIdsPath = path.join(CONFIG.BASE_PATH, configFiles.bannedids);
        const bannedIdsContent = await fs.readFile(bannedIdsPath, 'utf8');
        bannedIdsContent.trim().split('\n').forEach(id => {
            caches.bannedIds.add(id);
        });
        
        console.log('Loaded banned ids');
    } catch (error) {
        console.log('Banned IDs file does not exist.');
    }
}

// Utility functions
function sanitizeInput(input, maxLength = 0, regex = /[^a-zA-Z0-9]/g, toUpper = true) {
    if (typeof input !== 'string') return input;
    
    let result = input.replace(regex, '');
    if (toUpper) result = result.toUpperCase();
    if (maxLength > 0) result = result.slice(0, maxLength);
    
    return result;
}

function isRateLimited(cache, key, limit) {
    const now = Date.now();
    const lastRequest = cache.get(key);
    
    if (lastRequest && now - lastRequest < limit) {
        return true;
    }
    
    cache.set(key, now);
    return false;
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
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

// Data processing functions
function cleanAndFormatData(data) {
    return {
        directory: sanitizeInput(data.directory, 12),
        identity: sanitizeInput(data.identity, 12),
        region: sanitizeInput(data.region, 3),
        userid: sanitizeInput(data.userid, 20),
        isPrivate: Boolean(data.isPrivate),
        playerCount: Math.min(Math.max(parseInt(data.playerCount) || -1, -1), 10),
        gameMode: sanitizeInput(data.gameMode, 128),
        consoleVersion: String(data.consoleVersion || 'NULL').slice(0, 8),
        menuName: sanitizeInput(data.menuName, 24, /[^a-zA-Z0-9]/g, false),
        menuVersion: String(data.menuVersion || 'NULL').slice(0, 8)
    };
}

function cleanAndFormatSyncData(data) {
    const cleanedData = {
        directory: sanitizeInput(data.directory, 12),
        region: sanitizeInput(data.region, 3),
        data: {}
    };

    let count = 0;
    for (const userId in data.data) {
        if (count >= 10) break;
        
        const user = data.data[userId];
        const newUserId = sanitizeInput(userId, 20);
        
        const cleanedUser = {
            nickname: sanitizeInput(user.nickname, 12),
            cosmetics: String(user.cosmetics || '').toUpperCase().slice(0, 16384),
            color: String(user.color || 'NULL').slice(0, 20),
            platform: String(user.platform || 'NULL').slice(0, 5)
        };
        
        cleanedData.data[newUserId] = cleanedUser;
        processUserData(newUserId, cleanedUser, cleanedData.directory);
        
        count++;
    }

    return cleanedData;
}

function processUserData(userId, user, directory) {
    writeUserData(userId, user.nickname, user.cosmetics, directory, user.color, user.platform, Date.now());
    
    // Check for special cosmetics
    const cosmeticsMap = new Map([
        ["LBADE.", "FINGER PAINTER BADGE"],
        ["LBAAK.", "MOD STICK"],
        ["LBAAD.", "ADMINISTRATOR BADGE"],
        ["LBAGS.", "ILLUSTRATOR BADGE"],
        ["LMAPY.", "FOREST GUIDE MOD STICK"],
        ["LBANI.", "AA CREATOR BADGE"]
    ]);
    
    for (const [code, name] of cosmeticsMap) {
        if (user.cosmetics.includes(code)) {
            sendToSyncWebhook(directory, userId, `${code} : ${name}`, user.cosmetics, user.nickname, user.color, user.platform);
            break;
        }
    }
    
    // Check if user is in player ID map
    if (caches.playerIdMap.has(userId)) {
        sendToSyncWebhookID(directory, userId, caches.playerIdMap.get(userId), user.nickname, user.color, user.platform);
    }
}

function processBanData(data, ipHash) {
    const cleanedData = {
        error: sanitizeInput(data.error, 512, /[^a-zA-Z0-9 ]/g),
        version: String(data.version || '').slice(0, 8),
        data: []
    };

    if (!cleanedData.error.includes("YOUR ACCOUNT")) return null;

    for (let i = 0; i < Math.min(data.data.length, 512); i++) {
        cleanedData.data.push(sanitizeInput(data.data[i], 128, /[^a-zA-Z0-9 ]/g));
    }

    writeBanData(cleanedData.error, cleanedData.version, cleanedData.data, ipHash);
    sendToBanWebhook(cleanedData.error, cleanedData.version, cleanedData.data, ipHash);

    return cleanedData;
}

// Webhook functions with batching
const webhookBatches = {
    discord: { delay: 0, buffer: '', timeoutId: null },
    sync: { delay: 0, buffer: '', timeoutId: null }
};

async function sendWebhookBatch(type, webhookUrl, force = false) {
    const now = Date.now();
    const batch = webhookBatches[type];
    
    if (!force && now - batch.delay < 1000) {
        return false;
    }
    
    if (!batch.buffer) {
        batch.delay = now;
        return false;
    }
    
    const webhookData = JSON.stringify({
        content: batch.buffer
    });
    
    const url = new URL(webhookUrl);
    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(webhookData)
        },
        timeout: 5000
    };
    
    try {
        const req = https.request(options);
        req.write(webhookData);
        req.end();
        
        // Reset batch
        batch.buffer = '';
        batch.delay = now;
        return true;
    } catch (error) {
        console.error(`Error sending ${type} webhook:`, error);
        return false;
    }
}

function addToWebhookBatch(type, message, webhookUrl) {
    const batch = webhookBatches[type];
    batch.buffer += message + "\n\n";
    
    // Schedule send if not already scheduled
    if (!batch.timeoutId) {
        batch.timeoutId = setTimeout(() => {
            sendWebhookBatch(type, webhookUrl, true);
            batch.timeoutId = null;
        }, 1000);
    }
}

function sendToDiscordWebhook(data) {
    const message = `New connection received
> Room Data: \`${data.directory}\` \`${data.region}\` \`${data.gameMode}\` \`${data.isPrivate ? "Public" : "Private"}\` \`${data.playerCount.toString()} Players\`
> User Data: \`${data.identity}\` \`${data.userid}\` \`Console ${data.consoleVersion}\` \`${data.menuName} ${data.menuVersion}\``;

    addToWebhookBatch('discord', message, DISCORD_WEBHOOK_URL);
}

function sendToSyncWebhook(room, uidfound, cosmeticfound, concat, nickfound, color, platform) {
    if (room === "MOD" || room === "MODS" || caches.bannedIds.has(uidfound) || caches.bannedIds.has(nickfound)) {
        return;
    }
    
    const message = concat.length >= 6277 ? 
        `-# Cosmetx user ${nickfound} found in ${room} : ${cosmeticfound} ${concat.length}` : 
        `# Special User Found
> Room Data: \`${room}\`
> User Data: \`Name: ${nickfound}\` \`User ID: ${uidfound}\` \`Color: ${color}\` \`Platform: ${platform}\` \`Cosmetics: ${cosmeticfound} (concat length: ${concat.length})\`
||<@&1189695503399649280>||`;

    addToWebhookBatch('sync', message, SYNCDATA_WEBHOOK_URL);
}

function sendToSyncWebhookID(room, uidfound, userfound, nickfound, color, platform) {
    const message = `# ${userfound} Found
> Room Data: \`${room}\`
> User Data: \`Name: ${nickfound}\` \`User ID: ${uidfound}\` \`Color: ${color}\` \`Platform: ${platform}\`
||<@&1189695503399649280>||`;

    addToWebhookBatch('sync', message, SYNCDATA_WEBHOOK_URL);
}

function sendToBanWebhook(error, version, data, ipHash) {
    const message = `# Ban Report\n> Ban Message: ${error}\n> Version: ${version}\n-# Enabled Mods: ${data.toString().slice(0, 1024)}${data.toString().length >= 1024 ? "..." : ""}\n-# Report Request ID: ${ipHash}`;
    
    const webhookData = JSON.stringify({ content: message });
    const url = new URL(BANDATA_WEBHOOK_URL);
    
    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(webhookData)
        },
        timeout: 5000
    };
    
    const req = https.request(options);
    req.write(webhookData);
    req.end();
}

// File operations
async function writeUserData(userid, nickname, cosmetics, room, color, platform, timestamp) {
    const filename = `${userid}.json`;
    const filePath = path.join(CONFIG.BASE_PATH, 'Userdata', filename);
    
    const jsonData = {
        nickname,
        cosmetics,
        room,
        color,
        platform,
        timestamp
    };
    
    await fs.writeFile(filePath, JSON.stringify(jsonData), 'utf8');
}

async function writeBanData(error, version, data, ipHash) {
    const filename = `${ipHash}.json`;
    const filePath = path.join(CONFIG.BASE_PATH, 'Bandata', filename);
    
    const jsonData = { error, version, data };
    await fs.writeFile(filePath, JSON.stringify(jsonData), 'utf8');
}

async function writeTelemData(userid, ip, timestamp) {
    const userFile = path.join(CONFIG.BASE_PATH, 'Telemdata', `${userid}.json`);
    const ipFile = path.join(CONFIG.BASE_PATH, 'Ipdata', `${ip}.json`);
    
    const userData = { ip, timestamp };
    const ipData = { userid, timestamp };
    
    await Promise.all([
        fs.writeFile(userFile, JSON.stringify(userData), 'utf8'),
        fs.writeFile(ipFile, JSON.stringify(ipData), 'utf8')
    ]);
}

async function countFilesInDirectory(directory) {
    try {
        const files = await fs.readdir(directory);
        return files.length;
    } catch (error) {
        console.error('Error counting files:', error);
        return 0;
    }
}

async function ensureFriendDataFile(ipHash, clientIp) {
    const friendDataFileName = path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`);
    
    try {
        await fs.access(friendDataFileName);
    } catch (error) {
        const jsonData = {
            "private-ip": clientIp,
            "friends": [],
            "outgoing": [],
            "incoming": []
        };
        
        await fs.writeFile(friendDataFileName, JSON.stringify(jsonData, null, 4), 'utf8');
    }
}

function isUserOnline(ip) {
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
    const ws = caches.clients.get(ipHash);
    return ws && ws.readyState === WebSocket.OPEN;
}

// Request handlers
async function handleTelemetry(req, res, clientIp, ipHash) {
    if (isRateLimited(caches.ipRequestTimestamps, clientIp, CONFIG.RATE_LIMITS.TELEMETRY)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 429 }));
        return;
    }
    
    if (caches.bannedIps.has(clientIp) && Date.now() - caches.bannedIps.get(clientIp) < CONFIG.RATE_LIMITS.BAN_DURATION) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 400 }));
        return;
    }
    
    if (req.headers['user-agent'] !== CONFIG.VALIDATION.USER_AGENT) {
        caches.bannedIps.set(clientIp, Date.now());
        console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent']);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 400 }));
        return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    
    req.on('end', async () => {
        try {
            const data = JSON.parse(body);
            const cleanedData = cleanAndFormatData({
                directory: data.directory || '',
                identity: data.identity || '',
                region: data.region || 'NULL',
                userid: data.userid || 'NULL',
                isPrivate: data.directory?.length === 4 || data.isPrivate || false,
                playerCount: data.playerCount || -1,
                gameMode: data.gameMode || 'NULL',
                consoleVersion: data.consoleVersion || 'NULL',
                menuName: data.menuName || 'NULL',
                menuVersion: data.menuVersion || 'NULL'
            });
            
            caches.activeRooms.set(cleanedData.directory, {
                region: cleanedData.region,
                gameMode: cleanedData.gameMode,
                playerCount: cleanedData.playerCount,
                isPrivate: cleanedData.isPrivate,
                timestamp: Date.now()
            });
            
            await writeTelemData(cleanedData.userid, clientIp, Date.now());
            sendToDiscordWebhook(cleanedData);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 200 }));
        } catch (error) {
            console.error('Error processing telemetry:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 400 }));
        }
    });
}

async function handleSyncData(req, res, clientIp, ipHash) {
    if (isRateLimited(caches.syncDataRequestTimestamps, clientIp, CONFIG.RATE_LIMITS.SYNC_DATA)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 429 }));
        return;
    }
    
    if (caches.bannedIps.has(clientIp) && Date.now() - caches.bannedIps.get(clientIp) < CONFIG.RATE_LIMITS.BAN_DURATION) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 200 }));
        return;
    }
    
    if (req.headers['user-agent'] !== CONFIG.VALIDATION.USER_AGENT) {
        caches.bannedIps.set(clientIp, Date.now());
        console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent']);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 200 }));
        return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    
    req.on('end', async () => {
        try {
            const data = JSON.parse(body);
            const cleanedData = cleanAndFormatSyncData({
                directory: data.directory || '',
                region: data.region || 'NULL',
                data: data.data || {}
            });
            
            caches.activeUserData.set(cleanedData.directory, {
                region: cleanedData.region,
                roomdata: cleanedData.data,
                timestamp: Date.now()
            });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 200 }));
        } catch (error) {
            console.error('Error processing sync data:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 400 }));
        }
    });
}

async function handleReportBan(req, res, clientIp, ipHash) {
    if (isRateLimited(caches.reportBanRequestTimestamps, clientIp, CONFIG.RATE_LIMITS.REPORT_BAN)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 429 }));
        return;
    }
    
    if (caches.bannedIps.has(clientIp) && Date.now() - caches.bannedIps.get(clientIp) < CONFIG.RATE_LIMITS.BAN_DURATION) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 200 }));
        return;
    }
    
    if (req.headers['user-agent'] !== CONFIG.VALIDATION.USER_AGENT) {
        caches.bannedIps.set(clientIp, Date.now());
        console.log("Banned request 30 minutes for invalid user-agent: " + req.headers['user-agent']);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 200 }));
        return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    
    req.on('end', async () => {
        try {
            const data = JSON.parse(body);
            processBanData({
                error: data.error || '',
                version: data.version || '',
                data: data.data || []
            }, ipHash);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 200 }));
        } catch (error) {
            console.error('Error processing ban report:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 400 }));
        }
    });
}

async function handleGetRequest(req, res, url, clientIp, ipHash) {
    try {
        await ensureFriendDataFile(ipHash, clientIp);
        
        switch (url) {
            case '/usercount':
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ users: caches.clients.size }));
                break;
                
            case '/databasecount':
                const userdataDir = path.join(CONFIG.BASE_PATH, 'Userdata');
                const fileCount = await countFilesInDirectory(userdataDir);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ size: fileCount }));
                break;
                
            case '/telemcount':
                const telemDir = path.join(CONFIG.BASE_PATH, 'Telemdata');
                const telemCount = await countFilesInDirectory(telemDir);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ size: telemCount }));
                break;
                
            case '/serverdata':
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(serverData);
                break;
                
            default:
                // Handle POST-like GET requests that need body data
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                
                req.on('end', async () => {
                    try {
                        const data = body ? JSON.parse(body) : {};
                        
                        switch (url) {
                            case '/rooms':
                            case '/getsyncdata':
                            case '/getuserdata':
                            case '/gettelemdata':
                            case '/playermap':
                            case '/getblacklisted':
                                if (data.key !== SECRET_KEY) {
                                    res.writeHead(401, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ status: 401 }));
                                    return;
                                }
                                
                                await handleSecuredGetRequest(url, res, data);
                                break;
                                
                            default:
                                res.writeHead(404, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ status: 404 }));
                        }
                    } catch (error) {
                        console.error('Error processing GET request with body:', error);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 400 }));
                    }
                });
                break;
        }
    } catch (error) {
        console.error('Error handling GET request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 500 }));
    }
}

async function handleSecuredGetRequest(url, res, data) {
    try {
        switch (url) {
            case '/rooms':
                // Clean up old rooms
                const currentTime = Date.now();
                for (const [directory, room] of caches.activeRooms) {
                    if (currentTime - room.timestamp > 10 * 60 * 1000) {
                        caches.activeRooms.delete(directory);
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ activeRooms: Object.fromEntries(caches.activeRooms) }));
                break;
                
            case '/getsyncdata':
                // Clean up old user data
                const currentTime2 = Date.now();
                for (const [directory, userData] of caches.activeUserData) {
                    if (currentTime2 - userData.timestamp > 10 * 60 * 1000) {
                        caches.activeUserData.delete(directory);
                    }
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ activeUserData: Object.fromEntries(caches.activeUserData) }));
                break;
                
            case '/getuserdata':
                const uid = sanitizeInput(data.uid, 20);
                let userData = "{}";
                const userFilePath = path.join(CONFIG.BASE_PATH, 'Userdata', `${uid}.json`);
                
                try {
                    userData = await fs.readFile(userFilePath, 'utf8');
                } catch (error) {
                    console.log('UID file does not exist.');
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(userData);
                break;
                
            case '/gettelemdata':
                const telemUid = sanitizeInput(data.uid, 20);
                let telemData = "{}";
                const telemFilePath = path.join(CONFIG.BASE_PATH, 'Telemdata', `${telemUid}.json`);
                
                try {
                    telemData = await fs.readFile(telemFilePath, 'utf8');
                } catch (error) {
                    console.log('UID file does not exist.');
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(telemData);
                break;
                
            case '/playermap':
                let result = "";
                
                for (const [key, value] of caches.playerIdMap) {
                    const userFilePath = path.join(CONFIG.BASE_PATH, 'Userdata', `${key}.json`);
                    
                    try {
                        const userData = JSON.parse(await fs.readFile(userFilePath, 'utf8'));
                        result += `${value} (${key}) was last seen in ${userData.room} on ${formatTimestamp(userData.timestamp)} under the name ${userData.nickname}`;
                    } catch (error) {
                        result += `${value} (${key}) not in database`;
                    }
                    result += "\n";
                }
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ data: result }));
                break;
                
            case '/getblacklisted':
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ data: Array.from(caches.bannedIds).join("\n") }));
                break;
        }
    } catch (error) {
        console.error('Error handling secured GET request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 500 }));
    }
}

async function handlePostRequest(req, res, url, clientIp, ipHash) {
    try {
        await ensureFriendDataFile(ipHash, clientIp);
        
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        
        req.on('end', async () => {
            try {
                const data = body ? JSON.parse(body) : {};
                
                switch (url) {
                    case '/telementery':
                    case '/telemetry':
                        await handleTelemetry(req, res, clientIp, ipHash);
                        break;
                        
                    case '/syncdata':
                        await handleSyncData(req, res, clientIp, ipHash);
                        break;
                        
                    case '/reportban':
                        await handleReportBan(req, res, clientIp, ipHash);
                        break;
                        
                    case '/inviteall':
                    case '/inviterandom':
                    case '/notify':
                    case '/blacklistid':
                    case '/unblacklistid':
                    case '/tts':
                    case '/translate':
                    case '/frienduser':
                    case '/unfrienduser':
                        if (data.key !== SECRET_KEY) {
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 401 }));
                            return;
                        }
                        
                        await handleSecuredPostRequest(url, res, data, clientIp, ipHash);
                        break;
                        
                    default:
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 404 }));
                }
            } catch (error) {
                console.error('Error parsing POST request body:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 400 }));
            }
        });
    } catch (error) {
        console.error('Error handling POST request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 500 }));
    }
}

async function handleSecuredPostRequest(url, res, data, clientIp, ipHash) {
    try {
        switch (url) {
            case '/inviteall':
                const inviteAllMessage = JSON.stringify({
                    command: "invite",
                    from: "Server",
                    to: data.to
                });

                for (const [, ws] of caches.clients) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(inviteAllMessage);
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
                break;
                
            case '/inviterandom':
                const inviteMessage = JSON.stringify({
                    command: "invite",
                    from: "Server",
                    to: data.to
                });

                const sockets = Array.from(caches.clients.values());
                
                // Fisher-Yates shuffle
                for (let i = sockets.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [sockets[i], sockets[j]] = [sockets[j], sockets[i]];
                }

                sockets.slice(0, data.count).forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(inviteMessage);
                    }
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
                break;
                
            case '/notify':
                const notifyMessage = JSON.stringify({
                    command: "notification",
                    from: "Server",
                    message: data.message,
                    time: data.time
                });

                for (const [, ws] of caches.clients) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(notifyMessage);
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
                break;
                
            case '/blacklistid':
                caches.bannedIds.add(data.id);
                await fs.writeFile(
                    path.join(CONFIG.BASE_PATH, configFiles.bannedids), 
                    Array.from(caches.bannedIds).join("\n")
                );

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
                break;
                
            case '/unblacklistid':
                caches.bannedIds.delete(data.id);
                await fs.writeFile(
                    path.join(CONFIG.BASE_PATH, configFiles.bannedids), 
                    Array.from(caches.bannedIds).join("\n")
                );

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 200 }));
                break;
                
            case '/tts':
                if (!data.text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                    return;
                }

                const text = data.text.substring(0, 4096);
                const lang = sanitizeInput(data.lang || 'en', 6);
                const outputPath = 'output.wav';
                const noRCE = text.replace(/(["'$`\\])/g, '\\$1');

                exec(`flite -t "${noRCE}" -o ${outputPath}`, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`Error generating TTS with flite: ${error.message}`);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 500 }));
                        return;
                    }

                    fs.readFile(outputPath, (err, audioData) => {
                        if (err) {
                            console.error('Error reading WAV file:', err.message);
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 500 }));
                            return;
                        }

                        res.writeHead(200, { 'Content-Type': 'audio/wav' });
                        res.end(audioData, 'binary');
                    });
                });
                break;
                
            case '/translate':
                if (!data.text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400, error: 'Missing text' }));
                    return;
                }

                const textToTranslate = data.text.replace(/(["'$`\\])/g, '\\$1').substring(0, 4096);
                const targetLang = sanitizeInput(data.lang || 'es', 6);
                const hash = crypto.createHash('sha256').update(textToTranslate).digest('hex');
                const cacheDir = path.join(CONFIG.BASE_PATH, 'Translatedata', targetLang);
                const cachePath = path.join(cacheDir, `${hash}.txt`);

                try {
                    // Check cache first
                    const cached = await fs.readFile(cachePath, 'utf8');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ translation: cached }));
                    return;
                } catch (error) {
                    // Not in cache, proceed with translation
                    const extractedTags = extractTags(textToTranslate);
                    const translateUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
                    
                    try {
                        const response = await fetch(translateUrl);
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        
                        const result = await response.json();
                        let translation = result[0].map(x => x[0]).join('');
                        translation = replaceTags(translation, extractedTags);

                        // Ensure cache directory exists
                        await fs.mkdir(cacheDir, { recursive: true });
                        await fs.writeFile(cachePath, translation, 'utf8');

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ translation }));
                    } catch (translateError) {
                        console.error('Translation error:', translateError.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ status: 500 }));
                    }
                }
                break;
                
            case '/frienduser':
                if (isRateLimited(caches.friendModifyTime, clientIp, CONFIG.RATE_LIMITS.FRIEND_MODIFY)) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 429, error: "Too many requests." }));
                    return;
                }

                const target = sanitizeInput(data.uid, 20);
                
                try {
                    const targetTelemData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Telemdata', `${target}.json`), 'utf8'));
                    const ipData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Ipdata', `${clientIp}.json`), 'utf8'));
                    const telemData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Telemdata', `${ipData.userid}.json`), 'utf8'));

                    const targetHash = crypto.createHash('sha256').update(targetTelemData.ip).digest('hex');
                    const targetData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), 'utf8'));
                    const selfData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), 'utf8'));
                    
                    const bypassChecks = selfData.incoming.includes(targetHash) || targetData.outgoing.includes(ipHash);

                    if (targetTelemData.ip === clientIp) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You are trying to friend yourself."}));
                        return;
                    }
                    
                    if (telemData.ip !== clientIp && !bypassChecks) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "IP mismatch."}));
                        return;
                    }

                    if (!isUserOnline(clientIp)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You are not connected to the websocket."}));
                        return;
                    }

                    if (selfData.friends.length >= 50) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You have hit the friend limit."}));
                        return;
                    }

                    if (targetData.friends.length >= 50) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "This person has hit the friend limit."}));
                        return;
                    }

                    if (selfData.outgoing.length >= 50) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You have hit the outgoing friend request limit."}));
                        return;
                    }

                    if (targetData.friends.includes(ipHash) || selfData.friends.includes(targetHash)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You are already friends with this person."}));
                        return;
                    }

                    if (targetData.incoming.includes(ipHash)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({"status": 400, "error": "You have already sent a friend request to this person."}));
                        return;
                    }

                    if (selfData.incoming.includes(targetHash) || targetData.outgoing.includes(ipHash)) {
                        selfData.incoming = selfData.incoming.filter(entry => entry !== targetHash);
                        targetData.outgoing = targetData.outgoing.filter(entry => entry !== ipHash);

                        if (!selfData.friends.includes(targetHash)) selfData.friends.push(targetHash);
                        if (!targetData.friends.includes(ipHash)) targetData.friends.push(ipHash);
                    } else {
                        if (!selfData.outgoing.includes(targetHash)) selfData.outgoing.push(targetHash);
                        if (!targetData.incoming.includes(ipHash)) targetData.incoming.push(ipHash);
                    }

                    await Promise.all([
                        fs.writeFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), JSON.stringify(targetData, null, 2), 'utf8'),
                        fs.writeFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), JSON.stringify(selfData, null, 2), 'utf8')
                    ]);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({"status": 200}));
                } catch (error) {
                    console.error('Error processing friend request:', error);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                }
                break;
                
            case '/unfrienduser':
                if (isRateLimited(caches.friendModifyTime, clientIp, CONFIG.RATE_LIMITS.FRIEND_MODIFY)) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 429, error: "Too many requests." }));
                    return;
                }

                const targetHash = sanitizeInput(data.uid, 64);
                
                try {
                    const targetData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), 'utf8'));
                    const selfData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), 'utf8'));

                    if (!targetData.friends.includes(ipHash) && !selfData.friends.includes(targetHash)) {
                        if (selfData.outgoing.includes(targetHash) || targetData.incoming.includes(ipHash)) {
                            selfData.outgoing = selfData.outgoing.filter(entry => entry !== targetHash);
                            targetData.incoming = targetData.incoming.filter(entry => entry !== ipHash);
                        } else if (selfData.incoming.includes(targetHash) || targetData.outgoing.includes(ipHash)) {
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

                    await Promise.all([
                        fs.writeFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), JSON.stringify(targetData, null, 2), 'utf8'),
                        fs.writeFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), JSON.stringify(selfData, null, 2), 'utf8')
                    ]);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({"status": 200}));
                } catch (error) {
                    console.error('Error processing unfriend request:', error);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                }
                break;
                
            case '/getfriends':
                if (isRateLimited(caches.getFriendTime, clientIp, CONFIG.RATE_LIMITS.FRIEND_GET)) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 429 }));
                    return;
                }

                let targetUser = ipHash;
                if (data.key === SECRET_KEY && data.uid) {
                    targetUser = sanitizeInput(data.uid, 64);
                }

                try {
                    const selfFriendData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetUser}.json`), 'utf8'));
                    const returnData = {
                        "friends": {},
                        "incoming": {},
                        "outgoing": {}
                    };
                    
                    // Process friends
                    for (const friend of selfFriendData.friends) {
                        try {
                            const friendData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${friend}.json`), 'utf8'));
                            const ipData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Ipdata', `${friendData["private-ip"]}.json`), 'utf8'));
                            const userData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Userdata', `${ipData.userid}.json`), 'utf8'));

                            const friendId = ipData.userid;
                            const lastRoom = userData.room;
                            const online = isUserOnline(friendData["private-ip"]);

                            returnData.friends[friend] = {
                                "online": online,
                                "currentRoom": online ? lastRoom : "",
                                "currentName": userData.nickname,
                                "currentUserID": friendId
                            };
                        } catch (error) {
                            console.error(`Error processing friend ${friend}:`, error);
                        }
                    }
                    
                    // Process incoming requests
                    for (const friend of selfFriendData.incoming) {
                        try {
                            const friendData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${friend}.json`), 'utf8'));
                            const ipData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Ipdata', `${friendData["private-ip"]}.json`), 'utf8'));
                            const userData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Userdata', `${ipData.userid}.json`), 'utf8'));

                            returnData.incoming[friend] = {
                                "currentName": userData.nickname,
                                "currentUserID": ipData.userid
                            };
                        } catch (error) {
                            console.error(`Error processing incoming friend ${friend}:`, error);
                        }
                    }
                    
                    // Process outgoing requests
                    for (const friend of selfFriendData.outgoing) {
                        try {
                            const friendData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${friend}.json`), 'utf8'));
                            const ipData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Ipdata', `${friendData["private-ip"]}.json`), 'utf8'));
                            const userData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Userdata', `${ipData.userid}.json`), 'utf8'));

                            returnData.outgoing[friend] = {
                                "currentName": userData.nickname,
                                "currentUserID": ipData.userid
                            };
                        } catch (error) {
                            console.error(`Error processing outgoing friend ${friend}:`, error);
                        }
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(returnData));
                } catch (error) {
                    console.error('Error processing get friends request:', error);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 400 }));
                }
                break;
        }
    } catch (error) {
        console.error('Error handling secured POST request:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 500 }));
    }
}

// Main server
const server = http.createServer(async (req, res) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');
    
    console.log(`${ipHash} ${req.method} ${req.url}`);
    
    try {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        // Route handling
        if (req.method === 'POST') {
            await handlePostRequest(req, res, req.url, clientIp, ipHash);
        } else if (req.method === 'GET') {
            await handleGetRequest(req, res, req.url, clientIp, ipHash);
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 404 }));
        }
    } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 500 }));
    }
});

// WebSocket server
const wss = new WebSocket.Server({ server });
const socketDelay = new Map();

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');
    
    caches.clients.set(ipHash, ws);
    console.log(`Client connected from ${ipHash} (#${caches.clients.size})`);
    
    ws.on('message', async message => {
        if (isRateLimited(socketDelay, clientIp, CONFIG.RATE_LIMITS.SOCKET)) {
            return;
        }
        
        try {
            const data = JSON.parse(message.toString());
            const command = data.command;
            
            switch (command) {
                case "invite":
                    {
                        const targetRoom = sanitizeInput(data.room, 12);
                        const targetHash = sanitizeInput(data.target, 64);

                        try {
                            const targetData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), 'utf8'));
                            const selfData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), 'utf8'));

                            if (targetData.friends.includes(ipHash) || selfData.friends.includes(targetHash)) {
                                const targetWs = caches.clients.get(targetHash);
                                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                    targetWs.send(JSON.stringify({
                                        command: "invite",
                                        from: ipHash,
                                        to: targetRoom
                                    }));
                                }
                            }
                        } catch (error) {
                            console.error('Error processing invite:', error);
                        }
                        break;
                    }
                case "reqinvite":
                    {
                        const targetHash = sanitizeInput(data.target, 64);

                        try {
                            const targetData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), 'utf8'));
                            const selfData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), 'utf8'));

                            if (targetData.friends.includes(ipHash) || selfData.friends.includes(targetHash)) {
                                const targetWs = caches.clients.get(targetHash);
                                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                    targetWs.send(JSON.stringify({
                                        command: "reqinvite",
                                        from: ipHash
                                    }));
                                }
                            }
                        } catch (error) {
                            console.error('Error processing reqinvite:', error);
                        }
                        break;
                    }
                case "preferences":
                    {
                        const preferences = data.preferences;
                        const targetHash = sanitizeInput(data.target, 64);

                        try {
                            const targetData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), 'utf8'));
                            const selfData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), 'utf8'));

                            if (targetData.friends.includes(ipHash) || selfData.friends.includes(targetHash)) {
                                const targetWs = caches.clients.get(targetHash);
                                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                    targetWs.send(JSON.stringify({
                                        command: "preferences",
                                        from: ipHash,
                                        data: preferences
                                    }));
                                }
                            }
                        } catch (error) {
                            console.error('Error processing preferences:', error);
                        }
                        break;
                    }
                case "message":
                    {
                        const message = data.message;
                        const color = sanitizeInput(data.color, 12, /[^a-zA-Z0-9]/g, false);
                        const targetHash = sanitizeInput(data.target, 64);

                        try {
                            const targetData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${targetHash}.json`), 'utf8'));
                            const selfData = JSON.parse(await fs.readFile(path.join(CONFIG.BASE_PATH, 'Frienddata', `${ipHash}.json`), 'utf8'));

                            if (targetData.friends.includes(ipHash) || selfData.friends.includes(targetHash)) {
                                const targetWs = caches.clients.get(targetHash);
                                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                                    targetWs.send(JSON.stringify({
                                        command: "message",
                                        from: ipHash,
                                        message: message,
                                        color: color
                                    }));
                                }
                            }
                        } catch (error) {
                            console.error('Error processing message:', error);
                        }
                        break;
                    }
            }
        } catch (error) {
            console.error('Error processing websocket message:', error);
        }
    });
    
    ws.on('close', () => {
        caches.clients.delete(ipHash);
        console.log(`Client disconnected: ${ipHash}`);
    });
});

// Cleanup intervals
setInterval(() => {
    const now = Date.now();
    
    // Clean up active rooms
    for (const [directory, room] of caches.activeRooms) {
        if (now - room.timestamp > 10 * 60 * 1000) {
            caches.activeRooms.delete(directory);
        }
    }
    
    // Clean up active user data
    for (const [directory, data] of caches.activeUserData) {
        if (now - data.timestamp > 10 * 60 * 1000) {
            caches.activeUserData.delete(directory);
        }
    }
    
    // Clean up old rate limit entries
    const cleanCache = (cache, maxAge) => {
        for (const [key, timestamp] of cache) {
            if (now - timestamp > maxAge) {
                cache.delete(key);
            }
        }
    };
    
    cleanCache(caches.ipRequestTimestamps, 60000);
    cleanCache(caches.syncDataRequestTimestamps, 60000);
    cleanCache(caches.reportBanRequestTimestamps, 3600000);
    cleanCache(caches.getFriendTime, 60000);
    cleanCache(caches.friendModifyTime, 60000);
    cleanCache(socketDelay, 60000);
    
    // Clean up old banned IPs
    for (const [ip, timestamp] of caches.bannedIps) {
        if (now - timestamp > CONFIG.RATE_LIMITS.BAN_DURATION) {
            caches.bannedIps.delete(ip);
        }
    }
}, 60000); // Run every minute

// Start server
initializeServer().then(() => {
    server.listen(CONFIG.PORT, () => {
        console.log(`Server is running at http://localhost:${CONFIG.PORT}/`);
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});