const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function disconnectText(reason) {
  if (typeof reason === 'string') {
    try { return disconnectText(JSON.parse(reason)); } catch (_) { return reason; }
  }
  if (!reason || typeof reason !== 'object') return '';
  if (Array.isArray(reason)) return reason.map(disconnectText).join(' ');
  // The protocol can supply either ordinary chat components or NBT wrappers.
  if (reason.type && Object.prototype.hasOwnProperty.call(reason, 'value')) {
    return disconnectText(reason.value);
  }
  return ['text', 'translate', 'extra', 'with'].map(key => disconnectText(reason[key])).join(' ');
}

function isBanDisconnect(reason) {
  const text = disconnectText(reason).replace(/\u00a7[0-9a-fk-orx]/gi, '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\u0131/g, 'i').toLowerCase();
  if (/\b(?:not|never)\s+(?:been\s+)?banned\b/.test(text)) return false;
  return /\bbanned(?:_ip)?\b|multiplayer\.disconnect\.banned(?:_ip)?\b|\b(?:yasaklan|banlan)(?:din(?:iz)?|mis(?:tir)?)\b/.test(text);
}

function stopFile(root, host, port, username) {
  const key = [host.toLowerCase(), port, username.toLowerCase()].join(':');
  const id = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
  return path.join(root, '.account-stops', id + '.json');
}

function createAccountStop(root, host, port, username) {
  const file = stopFile(root, host, port, username);
  return {
    isStopped: () => fs.existsSync(file),
    stop: () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        // Keep only the stop decision; omit usernames, addresses and kick text.
        fs.writeFileSync(file, JSON.stringify({ reason: 'server-ban', at: new Date().toISOString() }), { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  };
}

module.exports = { isBanDisconnect, stopFile, createAccountStop };
