/**
 * War Danmaku — Audio Engine (File-based)
 *
 * 音频文件播放引擎。往 assets/audio/ 丢 MP3/WAV 文件即可，无需改代码。
 * 文件缺失时静默跳过，不影响游戏运行。
 *
 * IIFE 包裹，防 G8 const 跨文件冲突。
 */
(function() {
  'use strict';

  // ============================================================
  //  📁 音频文件映射 — 改成你的文件路径即可
  // ============================================================

  // 事件音效
  var SFX_MAP = {
    kill:         'assets/audio/sfx_kill.mp3',
    spawn:        'assets/audio/sfx_spawn.wav',
    death:        'assets/audio/sfx_death.wav',
    wrathOfGod:   'assets/audio/sfx_wrath.wav',
    fireArrow:    'assets/audio/sfx_fire_arrow.mp3',
    siege:        'assets/audio/sfx_siege.wav',
    speedBoost:   'assets/audio/sfx_speed_boost.wav',
    countdownTick:'assets/audio/sfx_countdown.wav',
    victory:      'assets/audio/sfx_victory.wav',
    defeat:       'assets/audio/sfx_defeat.wav',
    swordClang:   'assets/audio/sfx_sword_clang.wav',   // 近战交兵
    arrowWhoosh:  'assets/audio/sfx_arrow_whoosh.wav',  // 箭矢破空
    arrowHit:     'assets/audio/sfx_arrow_hit.wav',     // 箭矢命中
    castleArrow:  'assets/audio/sfx_castle_arrow.wav',  // 箭塔射击
    castleHit:    'assets/audio/sfx_castle_hit.wav',    // 攻城碎石
    battleAmbient:'assets/audio/sfx_battle_ambient.mp3',// 战场风声
    warDrum:      'assets/audio/sfx_war_drum.wav',      // 军队战鼓
  };

  // 兵种攻击音效（不同兵种不同声音）
  var UNIT_ATK_MAP = {
    militia:      'assets/audio/atk_militia.wav',
    swordsman:    'assets/audio/atk_swordsman.wav',
    knight:       'assets/audio/atk_knight.wav',
    archer:       'assets/audio/atk_archer.wav',
    catapult:     'assets/audio/atk_catapult.wav',
    royalGuard:   'assets/audio/atk_royalguard.wav',
    giant:        'assets/audio/atk_giant.wav',
    dragonKnight: 'assets/audio/atk_dragon.wav',
  };

  var BGM_MAP = {
    COUNTDOWN: 'assets/audio/bgm_countdown.wav',
    PLAYING:   'assets/audio/bgm_playing.mp3',
    ROUND_END: 'assets/audio/bgm_round_end.wav',
  };

  // ============================================================
  //  AudioEngine
  // ============================================================

  var AudioEngine = function() {
    var AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    // 创建时尝试恢复（如果已有用户手势）
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function() {});
    }

    // 音量层级
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.ctx.destination);

    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.5;
    this.bgmGain.connect(this.masterGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.masterGain);

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.15;  // 环境音较低
    this.ambientGain.connect(this.masterGain);

    // 状态
    this._muted = false;
    this._bgmState = '';
    this._buffers = {};        // name → AudioBuffer
    this._loaded = false;      // loadAll() 完成标记
    this._bgmSource = null;    // 当前 BGM sourceNode
    this._bgmFadeTimer = null; // BGM 淡出定时器
    this._ambientSource = null;// 环境音 sourceNode
    this._lastKillTime = 0;
    this._loadPromise = null;
  };

  // ============================================================
  //  预加载所有音频文件
  // ============================================================

  AudioEngine.prototype.loadAll = function() {
    if (this._loadPromise) return this._loadPromise;

    var self = this;
    var ctx = this.ctx;
    var tasks = [];

    // 收集所有文件路径（去重）
    var paths = {};
    Object.keys(SFX_MAP).forEach(function(k) { paths[SFX_MAP[k]] = true; });
    Object.keys(BGM_MAP).forEach(function(k) { paths[BGM_MAP[k]] = true; });
    Object.keys(UNIT_ATK_MAP).forEach(function(k) { paths[UNIT_ATK_MAP[k]] = true; });

    var pathList = Object.keys(paths);
    console.log('[Audio] Loading ' + pathList.length + ' audio files...');

    for (var i = 0; i < pathList.length; i++) {
      (function(path) {
        var task = fetch(path)
          .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.arrayBuffer();
          })
          .then(function(buf) { return ctx.decodeAudioData(buf); })
          .then(function(audioBuf) {
            // 反向索引：path → buffer
            self._buffers[path] = audioBuf;
            console.log('[Audio] Loaded: ' + path + ' (' +
                        audioBuf.duration.toFixed(1) + 's ' +
                        audioBuf.sampleRate + 'Hz)');
          })
          .catch(function(e) {
            console.warn('[Audio] Missing: ' + path + ' (' + e.message + ')');
            // 不阻塞，缺失文件静默跳过
          });
        tasks.push(task);
      })(pathList[i]);
    }

    this._loadPromise = Promise.all(tasks).then(function() {
      self._loaded = true;
      var count = Object.keys(self._buffers).length;
      console.log('[Audio] Preload done — ' + count + '/' + pathList.length + ' loaded');
      // 如果游戏已经开始，补启动 BGM
      if (self._bgmState && self._bgmState !== 'WAITING') {
        self._startBGM(self._bgmState);
      }
    });

    return this._loadPromise;
  };

  // ============================================================
  //  确保运行
  // ============================================================

  AudioEngine.prototype._ok = function() {
    if (this.ctx.state === 'running') return true;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function() {});
      return false;
    }
    return false;
  };

  AudioEngine.prototype.resume = function() {
    var self = this;
    if (this.ctx.state === 'suspended') {
      return this.ctx.resume().then(function() {
        console.log('[Audio] Resumed');
        // 补启动 BGM
        if (self._loaded && self._bgmState && self._bgmState !== 'WAITING') {
          self._startBGM(self._bgmState);
        }
      });
    }
    return Promise.resolve();
  };

  // ============================================================
  //  音量 & 静音
  // ============================================================

  AudioEngine.prototype.setMasterVolume = function(v) {
    this.masterGain.gain.value = Math.max(0, Math.min(1, v));
    if (v > 0) this._muted = false;
  };
  AudioEngine.prototype.setBGMVolume = function(v) {
    this.bgmGain.gain.value = Math.max(0, Math.min(1, v));
  };
  AudioEngine.prototype.setSFXVolume = function(v) {
    this.sfxGain.gain.value = Math.max(0, Math.min(1, v));
  };
  AudioEngine.prototype.toggleMute = function() {
    this._muted = !this._muted;
    if (this._muted) {
      this._preMuteMaster = this.masterGain.gain.value;
      this.masterGain.gain.value = 0;
    } else {
      this.masterGain.gain.value = this._preMuteMaster || 0.7;
    }
  };
  AudioEngine.prototype.isMuted = function() { return this._muted; };

  // ============================================================
  //  BGM 状态机
  // ============================================================

  AudioEngine.prototype.setBGMState = function(state) {
    if (state === this._bgmState) return;
    console.log('[Audio] BGM:', this._bgmState, '→', state);
    this._bgmState = state;

    if (!this._loaded || !this._ok()) return;

    if (state === 'WAITING') {
      this._stopBGM();
    } else {
      this._startBGM(state);
    }
  };

  /** 启播 BGM（带 200ms 淡入） */
  AudioEngine.prototype._startBGM = function(state) {
    this._stopBGM();
    if (!this._ok()) return;

    var path = BGM_MAP[state];
    if (!path) return;
    var buf = this._buffers[path];
    if (!buf) { console.warn('[Audio] BGM buffer not loaded:', path); return; }

    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;

    var fadeGain = ctx.createGain();
    fadeGain.gain.setValueAtTime(0, ctx.currentTime);
    fadeGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.2);

    src.connect(fadeGain);
    fadeGain.connect(this.bgmGain);
    src.start();
    this._bgmSource = { src: src, fadeGain: fadeGain };
    console.log('[Audio] BGM playing:', path, '(' + buf.duration.toFixed(1) + 's loop)');
  };

  /** 停止 BGM（200ms 淡出） */
  AudioEngine.prototype._stopBGM = function() {
    var bgm = this._bgmSource;
    if (!bgm) return;

    var ctx = this.ctx;
    var now = ctx.currentTime;
    try {
      bgm.fadeGain.gain.cancelScheduledValues(now);
      bgm.fadeGain.gain.setValueAtTime(bgm.fadeGain.gain.value, now);
      bgm.fadeGain.gain.linearRampToValueAtTime(0, now + 0.2);
      bgm.src.stop(now + 0.25);
    } catch (e) { /* 可能已停止 */ }

    var self = this;
    if (this._bgmFadeTimer) clearTimeout(this._bgmFadeTimer);
    this._bgmFadeTimer = setTimeout(function() {
      try { bgm.src.disconnect(); } catch (e) {}
      try { bgm.fadeGain.disconnect(); } catch (e) {}
      if (self._bgmSource === bgm) self._bgmSource = null;
    }, 300);

    this._bgmSource = null;
  };

  // ============================================================
  //  环境音（战场风声，循环播放）
  // ============================================================

  AudioEngine.prototype.playBattleAmbient = function() {
    if (!this._loaded || !this._ok() || this._ambientSource) return;
    var path = SFX_MAP['battleAmbient'];
    var buf = this._buffers[path];
    if (!buf) return;
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;
    src.connect(this.ambientGain);
    src.start();
    this._ambientSource = src;
    console.log('[Audio] Ambient started');
  };

  AudioEngine.prototype.stopBattleAmbient = function() {
    if (!this._ambientSource) return;
    var ctx = this.ctx;
    var src = this._ambientSource;
    var now = ctx.currentTime;
    // 淡出
    this.ambientGain.gain.cancelScheduledValues(now);
    this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
    this.ambientGain.gain.linearRampToValueAtTime(0, now + 0.5);
    try { src.stop(now + 0.6); } catch (e) {}
    setTimeout(function() { try { src.disconnect(); } catch (e) {} }, 700);
    this._ambientSource = null;
    console.log('[Audio] Ambient stopped');
  };

  AudioEngine.prototype.playWarDrum = function() {
    this._playSFX('warDrum', 0.6);
  };

  // ============================================================
  //  SFX 播放核心
  // ============================================================

  /**
   * 播放一个 SFX。
   * @param {string} name — SFX_MAP 中的 key
   * @param {number} [volMul=1] — 额外音量倍率
   */
  /** 直接用文件路径播放（用于 UNIT_ATK_MAP 等不以 name 索引的映射） */
  AudioEngine.prototype._playPath = function(path, dest) {
    if (!this._loaded || !this._ok()) return;
    var buf = this._buffers[path];
    if (!buf) return;
    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest || this.sfxGain);
    src.start();
    src.onended = function() { src.disconnect(); };
  };

  AudioEngine.prototype._playSFX = function(name, volMul) {
    if (!this._loaded || !this._ok()) return;

    var path = SFX_MAP[name];
    if (!path) return;
    var buf = this._buffers[path];
    if (!buf) return; // 文件不存在，静默跳过

    var ctx = this.ctx;
    var src = ctx.createBufferSource();
    src.buffer = buf;

    var g = ctx.createGain();
    g.gain.value = (volMul !== undefined ? volMul : 1);

    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
    // 播放完毕后自动清理
    src.onended = function() { src.disconnect(); g.disconnect(); };
  };

  // ============================================================
  //  公开 SFX 方法 — 一一对应事件类型
  // ============================================================

  AudioEngine.prototype.playSwordClang = function()   { this._playSFX('swordClang'); };
  AudioEngine.prototype.playArrowWhoosh = function()  { this._playSFX('arrowWhoosh'); };
  AudioEngine.prototype.playArrowHit = function()     { this._playSFX('arrowHit'); };
  AudioEngine.prototype.playCastleArrow = function()  { this._playSFX('castleArrow'); };
  AudioEngine.prototype.playCastleHit = function()    { this._playSFX('castleHit'); };
  AudioEngine.prototype.playUnitAttack = function(key) {
    if (!key) return;
    var path = UNIT_ATK_MAP[key];
    if (!path) return;
    this._playPath(path, this.sfxGain);
  };
  AudioEngine.prototype.playKill = function() {
    var now = Date.now();
    if (now - this._lastKillTime < 60) return; // 节流
    this._lastKillTime = now;
    this._playSFX('kill');
  };
  AudioEngine.prototype.playSpawn = function()       { this._playSFX('spawn'); };
  AudioEngine.prototype.playDeath = function()       { this._playSFX('death'); };
  AudioEngine.prototype.playWrathOfGod = function()  { this._playSFX('wrathOfGod'); };
  AudioEngine.prototype.playFireArrow = function()   { this._playSFX('fireArrow'); };
  AudioEngine.prototype.playSiege = function()       { this._playSFX('siege'); };
  AudioEngine.prototype.playSpeedBoost = function()  { this._playSFX('speedBoost'); };
  AudioEngine.prototype.playCountdownTick = function() { this._playSFX('countdownTick'); };
  AudioEngine.prototype.playVictory = function()     { this._playSFX('victory'); };
  AudioEngine.prototype.playDefeat = function()      { this._playSFX('defeat'); };

  // ============================================================
  //  暴露
  // ============================================================

  window.AudioEngine = AudioEngine;
  window.audioEngine = new AudioEngine();

  // 自动开始预加载
  window.audioEngine.loadAll();

  console.log('[Audio] Engine ready. File-based mode — ' +
              Object.keys(SFX_MAP).length + ' SFX + ' +
              Object.keys(BGM_MAP).length + ' BGM tracks configured.');
  console.log('[Audio] Drop your .mp3 files into assets/audio/ and refresh.');
  console.log('[Audio] State:', window.audioEngine.ctx.state);
})();
