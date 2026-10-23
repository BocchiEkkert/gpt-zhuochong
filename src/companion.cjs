'use strict';
const defaults = require('../renderer/dialogue.js');
const { localDay } = require('./model.cjs');
const CATEGORIES = ['click', 'idle', 'affection', 'sleepy', 'welcome', 'cheer'];
const MOTIONS = { click: 'touch', idle: 'idle', affection: 'cuddle', sleepy: 'sleepy', welcome: 'peek', cheer: 'party' };
class Companion {
  constructor({ random = Math.random, history = {}, saveHistory = () => {} } = {}) {
    this.random = random; this.history = history; this.saveHistory = saveHistory;
    this.last = new Map(); this.indices = new Map(); this.recent = [];
    this.armed = false; this.lastInteraction = -Infinity;
  }
  choose(settings, category) {
    const bank = settings.phraseBanks[category] || defaults[category];
    let choices = bank.filter(text => !this.recent.includes(text));
    if (!choices.length) choices = bank.filter(text => text !== this.last.get(category));
    if (!choices.length) choices = bank;
    let text;
    if (settings.speechOrder === 'sequential') {
      const index = this.indices.get(category) || 0;
      text = bank[index % bank.length]; this.indices.set(category, index + 1);
      if (text === this.recent.at(-1) && bank.length > 1) {
        text = bank[(index + 1) % bank.length]; this.indices.set(category, index + 2);
      }
    } else text = choices[Math.floor(this.random() * choices.length) % choices.length];
    this.last.set(category, text); this.recent.push(text); this.recent = this.recent.slice(-8);
    return { text, category, motion: MOTIONS[category] };
  }
  interact(settings, category = 'click', now = Date.now()) {
    // Coalesce rapid clicks instead of queuing animations or extending the bubble forever.
    if (now - this.lastInteraction < 1200) return null;
    this.lastInteraction = now;
    return this.choose(settings, category);
  }
  resetIdle() { this.armed = false; }
  tick(settings, context, now = Date.now()) {
    const { idleSeconds, visible, blocked, running } = context;
    if (!Number.isFinite(idleSeconds) || idleSeconds < 0) return null;
    const threshold = settings.idleMinutes * 60;
    if (idleSeconds < threshold) this.armed = true;
    const day = localDay(new Date(now));
    if (this.history.day !== day) this.history = { day, count: 0, lastAt: this.history.lastAt || 0 };
    const caps = { quiet: 4, normal: 8, lively: 12 };
    const multipliers = { quiet: 2, normal: 1, lively: 0.5 };
    const cooldown = Math.max(5, settings.cooldownMinutes * multipliers[settings.speechFrequency]) * 60000;
    if (!settings.speechEnabled || !visible || blocked || running) {
      // Returning from hidden/locked/quiet mode requires fresh activity before another utterance.
      this.armed = false; return null;
    }
    if (!this.armed || idleSeconds < threshold || this.history.count >= caps[settings.speechFrequency] || now - Math.max(this.history.lastAt, this.lastInteraction) < cooldown) return null;
    this.armed = false; this.history.count++; this.history.lastAt = now;
    this.saveHistory({ ...this.history });
    const category = idleSeconds >= 15 * 60 ? 'sleepy' : this.random() < 0.7 ? 'idle' : 'affection';
    return this.choose(settings, category);
  }
}
module.exports = { Companion, CATEGORIES };
