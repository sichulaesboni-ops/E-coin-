// ============================================
// ECoin Tap-to-Earn - Main Application
// Version: 2.1.0 - Anti-Cheat Enabled
// ============================================

// ============================================
// TOKENOMICS & CONSTANTS
// ============================================
const TOKENOMICS = {
    TOTAL_SUPPLY: 1000000,        // 1,000,000 ETC total
    TAP_RATE: 0.001,              // 0.001 ETC per tap (1000 taps = 1 ETC)
    MAX_TAPS_PER_DAY: 5000,       // Daily limit to prevent abuse
    ENERGY_MAX: 100,
    ENERGY_REGEN_RATE: 1,          // Per 3 seconds
    ENERGY_COST_PER_TAP: 1,
    LEVEL_UP_THRESHOLD: 100,       // Taps to level up
    MULTIPLIER_PER_LEVEL: 0.05,    // 5% more per level
    COOLDOWN_MS: 150,              // Minimum time between taps
    MAX_TAPS_PER_SECOND: 5,        // Anti-cheat: max 5 taps/sec
    DISTRIBUTION_THRESHOLD: 100    // Minimum points to receive ETC
};

// ============================================
// TELEGRAM INITIALIZATION
// ============================================
const tg = window.Telegram.WebApp;
tg.expand();

// ============================================
// STATE MANAGEMENT
// ============================================
class GameState {
    constructor() {
        this.userId = tg.initDataUnsafe?.user?.id || 'anonymous';
        this.userName = tg.initDataUnsafe?.user?.first_name || 'Mchezaji';
        this.balance = 0;
        this.totalTaps = 0;
        this.todayTaps = 0;
        this.level = 1;
        this.energy = TOKENOMICS.ENERGY_MAX;
        this.lastTapTime = 0;
        this.tapHistory = [];
        this.walletAddress = '';
        this.isWalletSaved = false;
        this.lastSaveTime = Date.now();
        this.totalDistributed = 0;
        this.multiplier = 1.0;
        this.todayDate = new Date().toDateString();
        this.isInitialized = false;
    }

    // Load from localStorage
    load() {
        try {
            const saved = localStorage.getItem('ecoin_game_state');
            if (saved) {
                const data = JSON.parse(saved);
                Object.assign(this, data);
                
                // Reset daily taps if new day
                const today = new Date().toDateString();
                if (this.todayDate !== today) {
                    this.todayTaps = 0;
                    this.todayDate = today;
                }
                
                // Regenerate energy since last save
                const timeSinceSave = (Date.now() - this.lastSaveTime) / 1000;
                const energyRegen = Math.floor(timeSinceSave / 3) * TOKENOMICS.ENERGY_REGEN_RATE;
                this.energy = Math.min(this.energy + energyRegen, TOKENOMICS.ENERGY_MAX);
                
                this.isInitialized = true;
                return true;
            }
        } catch (e) {
            console.warn('Error loading state:', e);
        }
        return false;
    }

    // Save to localStorage
    save() {
        try {
            this.lastSaveTime = Date.now();
            localStorage.setItem('ecoin_game_state', JSON.stringify(this));
            
            // Also save to Telegram CloudStorage if available
            if (tg.CloudStorage) {
                tg.CloudStorage.setItem('ecoin_state', JSON.stringify(this), (err) => {
                    if (err) console.warn('CloudStorage save failed:', err);
                });
            }
            return true;
        } catch (e) {
            console.warn('Error saving state:', e);
            return false;
        }
    }

    // Load from Telegram CloudStorage as backup
    async loadFromCloud() {
        return new Promise((resolve) => {
            if (!tg.CloudStorage) {
                resolve(false);
                return;
            }
            
            tg.CloudStorage.getItem('ecoin_state', (err, data) => {
                if (err || !data) {
                    resolve(false);
                    return;
                }
                
                try {
                    const parsed = JSON.parse(data);
                    Object.assign(this, parsed);
                    resolve(true);
                } catch (e) {
                    resolve(false);
                }
            });
        });
    }
}

// ============================================
// ANTI-CHEAT SYSTEM
// ============================================
class AntiCheatSystem {
    constructor() {
        this.tapTimestamps = [];
        this.suspiciousActivity = false;
        this.consecutiveFastTaps = 0;
        this.tapWindow = [];
        this.MAX_WINDOW_SIZE = 10;
        this.WINDOW_MS = 1000;
        this.MAX_TAPS_IN_WINDOW = TOKENOMICS.MAX_TAPS_PER_SECOND;
    }

    // Check if tap is valid
    validateTap(timestamp) {
        // Clean old timestamps
        const cutoff = timestamp - this.WINDOW_MS;
        this.tapTimestamps = this.tapTimestamps.filter(t => t > cutoff);
        
        // Check if over limit
        if (this.tapTimestamps.length >= this.MAX_TAPS_IN_WINDOW) {
            this.suspiciousActivity = true;
            this.consecutiveFastTaps++;
            return false;
        }
        
        // Check for automation patterns
        if (this.consecutiveFastTaps > 3) {
            this.suspiciousActivity = true;
            return false;
        }
        
        this.tapTimestamps.push(timestamp);
        this.consecutiveFastTaps = Math.max(0, this.consecutiveFastTaps - 1);
        this.suspiciousActivity = false;
        return true;
    }

    // Reset suspicious flag after cooldown
    resetSuspicion() {
        if (this.consecutiveFastTaps > 0) {
            this.consecutiveFastTaps = Math.max(0, this.consecutiveFastTaps - 1);
        }
        if (this.consecutiveFastTaps === 0) {
            this.suspiciousActivity = false;
        }
    }

    // Get security status
    isSuspicious() {
        return this.suspiciousActivity;
    }
}

// ============================================
// MAIN APPLICATION
// ============================================
class ECoinApp {
    constructor() {
        this.state = new GameState();
        this.antiCheat = new AntiCheatSystem();
        this.elements = {};
        this.tapCooldown = false;
        this.animationFrame = null;
        this.leaderboardCache = [];
        this.lastLeaderboardUpdate = 0;
        
        this.init();
    }

    init() {
        // Load state
        const loaded = this.state.load();
        if (!loaded) {
            // Try cloud storage
            this.state.loadFromCloud().then(() => {
                this.state.save();
                this.updateUI();
            });
        }
        
        // Cache DOM elements
        this.cacheElements();
        
        // Setup UI
        this.setupUI();
        
        // Start energy regeneration
        this.startEnergyRegeneration();
        
        // Setup periodic saves
        this.setupAutoSave();
        
        // Load leaderboard
        this.loadLeaderboard();
        
        // Setup Telegram Main Button
        this.setupTelegramMainButton();
        
        // Update UI
        this.updateUI();
        
        // Log security
        console.log('🔒 Anti-Cheat System Active');
        console.log(`💰 Total Supply: ${TOKENOMICS.TOTAL_SUPPLY} ETC`);
        console.log(`⚡ Tap Rate: ${TOKENOMICS.TAP_RATE} ETC per tap`);
    }

    cacheElements() {
        this.elements = {
            userName: document.getElementById('userName'),
            balance: document.getElementById('balance'),
            balanceSub: document.querySelector('.balance-sub'),
            energyFill: document.getElementById('energyFill'),
            energyText: document.getElementById('energyText'),
            tapButton: document.getElementById('tapButton'),
            tapPoints: document.getElementById('tapPoints'),
            todayTaps: document.getElementById('todayTaps'),
            multiplier: document.getElementById('multiplier'),
            levelDisplay: document.getElementById('levelDisplay'),
            totalPoints: document.getElementById('totalPoints'),
            totalTaps: document.getElementById('totalTaps'),
            totalPlayers: document.getElementById('totalPlayers'),
            totalDistributed: document.getElementById('totalDistributed'),
            progressBar: document.getElementById('progressBar'),
            progressText: document.getElementById('progressText'),
            walletAddress: document.getElementById('walletAddress'),
            saveWalletBtn: document.getElementById('saveWalletBtn'),
            walletStatus: document.getElementById('walletStatus'),
            leaderboardList: document.getElementById('leaderboardList'),
            refreshLeaderboard: document.getElementById('refreshLeaderboard'),
            coinImage: document.getElementById('coinImage')
        };
    }

    setupUI() {
        // Set user name
        this.elements.userName.textContent = this.state.userName;
        
        // Wallet input events
        this.elements.walletAddress.addEventListener('input', () => this.validateWalletInput());
        this.elements.saveWalletBtn.addEventListener('click', () => this.saveWallet());
        
        // Tap button events
        this.elements.tapButton.addEventListener('click', (e) => this.handleTap(e));
        this.elements.tapButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleTap(e);
        }, { passive: false });
        
        // Leaderboard refresh
        this.elements.refreshLeaderboard.addEventListener('click', () => this.loadLeaderboard());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                this.handleTap(e);
            }
        });
    }

    // ============================================
    // TAP HANDLING
    // ============================================
    handleTap(event) {
        // Check cooldown
        const now = Date.now();
        if (this.tapCooldown) return;
        
        // Check energy
        if (this.state.energy < TOKENOMICS.ENERGY_COST_PER_TAP) {
            this.showNotification('⚡ Nishati imeisha! Subiri ijaze.');
            return;
        }
        
        // Check daily limit
        if (this.state.todayTaps >= TOKENOMICS.MAX_TAPS_PER_DAY) {
            this.showNotification('📊 Umefikia kikomo cha taps leo! Rudi kesho.');
            return;
        }
        
        // Anti-cheat validation
        if (!this.antiCheat.validateTap(now)) {
            this.showNotification('⚠️ Shughuli isiyo ya kawaida! Tafadhali pumzika.');
            this.elements.tapButton.classList.add('disabled');
            setTimeout(() => {
                this.elements.tapButton.classList.remove('disabled');
                this.antiCheat.resetSuspicion();
            }, 3000);
            return;
        }
        
        // Process tap
        this.processTap(now);
    }

    processTap(timestamp) {
        // Deduct energy
        this.state.energy -= TOKENOMICS.ENERGY_COST_PER_TAP;
        
        // Calculate points with multiplier
        const basePoints = TOKENOMICS.TAP_RATE;
        const multiplier = 1 + (this.state.level - 1) * TOKENOMICS.MULTIPLIER_PER_LEVEL;
        const points = basePoints * multiplier;
        
        // Update state
        this.state.balance += points;
        this.state.totalTaps += 1;
        this.state.todayTaps += 1;
        this.state.multiplier = multiplier;
        
        // Level up
        const newLevel = Math.floor(this.state.totalTaps / TOKENOMICS.LEVEL_UP_THRESHOLD) + 1;
        if (newLevel > this.state.level) {
            this.state.level = newLevel;
            this.showNotification(`🎉 Ngazi ${newLevel}! Multiplier +${(TOKENOMICS.MULTIPLIER_PER_LEVEL * 100).toFixed(0)}%`);
        }
        
        // Update UI
        this.updateUI();
        
        // Visual effects
        this.animateTap();
        this.showFloatingText(points);
        
        // Trigger haptic feedback
        if (tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
        
        // Auto save (debounced)
        this.debounceSave();
        
        // Set cooldown
        this.tapCooldown = true;
        setTimeout(() => {
            this.tapCooldown = false;
        }, TOKENOMICS.COOLDOWN_MS);
        
        // Reset anti-cheat suspicion gradually
        setTimeout(() => {
            this.antiCheat.resetSuspicion();
        }, 2000);
    }

    // ============================================
    // UI UPDATE FUNCTIONS
    // ============================================
    updateUI() {
        // Balance
        this.elements.balance.textContent = this.state.balance.toFixed(3);
        this.elements.balanceSub.textContent = `≈ ${(this.state.balance * 0.01).toFixed(4)} ETC`;
        
        // Energy
        const energyPercent = (this.state.energy / TOKENOMICS.ENERGY_MAX) * 100;
        this.elements.energyFill.style.width = `${energyPercent}%`;
        this.elements.energyText.textContent = `${Math.floor(this.state.energy)}/${TOKENOMICS.ENERGY_MAX}`;
        
        // Stats
        this.elements.todayTaps.textContent = this.state.todayTaps;
        this.elements.multiplier.textContent = `${this.state.multiplier.toFixed(2)}x`;
        this.elements.levelDisplay.textContent = this.state.level;
        this.elements.totalPoints.textContent = this.state.balance.toFixed(1);
        this.elements.totalTaps.textContent = this.state.totalTaps;
        
        // Tap points display
        const basePoints = TOKENOMICS.TAP_RATE * this.state.multiplier;
        this.elements.tapPoints.textContent = `+${basePoints.toFixed(3)}`;
        
        // Progress to next level
        const tapsInLevel = this.state.totalTaps % TOKENOMICS.LEVEL_UP_THRESHOLD;
        const progress = (tapsInLevel / TOKENOMICS.LEVEL_UP_THRESHOLD) * 100;
        this.elements.progressBar.style.width = `${progress}%`;
        this.elements.progressText.textContent = `${progress.toFixed(0)}% hadi Ngazi ${this.state.level + 1}`;
        
        // Wallet status
        if (this.state.isWalletSaved) {
            this.elements.walletAddress.value = this.state.walletAddress;
            this.elements.walletAddress.disabled = true;
            this.elements.saveWalletBtn.textContent = '✅ Imeshahifadhiwa';
            this.elements.saveWalletBtn.disabled = true;
        }
        
        // Update document title
        document.title = `💰 ${this.state.balance.toFixed(1)} ETC - ECoin Tap`;
    }

    // ============================================
    // ANIMATIONS & VISUAL EFFECTS
    // ============================================
    animateTap() {
        this.elements.tapButton.classList.add('tap-animation');
        setTimeout(() => {
            this.elements.tapButton.classList.remove('tap-animation');
        }, 150);
        
        // Coin rotation
        this.elements.coinImage.style.transform = 'rotate(15deg) scale(0.9)';
        setTimeout(() => {
            this.elements.coinImage.style.transform = 'rotate(0deg) scale(1)';
        }, 150);
    }

    showFloatingText(points) {
        const text = document.createElement('div');
        text.className = 'float-text';
        text.textContent = `+${points.toFixed(3)}`;
        text.style.left = `${window.innerWidth / 2 - 30}px`;
        text.style.top = `${window.innerHeight / 2 - 100}px`;
        document.body.appendChild(text);
        setTimeout(() => text.remove(), 1000);
    }

    showNotification(message) {
        if (tg.showAlert) {
            tg.showAlert(message);
        } else {
            alert(message);
        }
    }

    // ============================================
    // ENERGY REGENERATION
    // ============================================
    startEnergyRegeneration() {
        setInterval(() => {
            if (this.state.energy < TOKENOMICS.ENERGY_MAX) {
                this.state.energy = Math.min(
                    this.state.energy + TOKENOMICS.ENERGY_REGEN_RATE,
                    TOKENOMICS.ENERGY_MAX
                );
                this.updateUI();
            }
        }, 3000);
    }

    // ============================================
    // AUTO-SAVE SYSTEM
    // ============================================
    debounceSave() {
        clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
            this.state.save();
        }, 2000);
    }

    setupAutoSave() {
        setInterval(() => {
            this.state.save();
        }, 30000); // Save every 30 seconds
    }

    // ============================================
    // WALLET MANAGEMENT
    // ============================================
    validateWalletInput() {
        const address = this.elements.walletAddress.value.trim();
        if (address.length === 0) {
            this.elements.walletAddress.style.borderColor = 'var(--border-color)';
            return;
        }
        
        if (address.startsWith('0x') && address.length === 42 && /^0x[a-fA-F0-9]{40}$/.test(address)) {
            this.elements.walletAddress.style.borderColor = '#2ed573';
        } else {
            this.elements.walletAddress.style.borderColor = '#ff4757';
        }
    }

    saveWallet() {
        const address = this.elements.walletAddress.value.trim();
        
        // Validate
        if (!address.startsWith('0x') || address.length !== 42) {
            this.showWalletStatus('error', '❌ Anwani batili! Inatakiwa ianze na "0x" na iwe na herufi 42.');
            return;
        }
        
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            this.showWalletStatus('error', '❌ Anwani batili! Tafadhali ingiza anwani halali ya Ethereum.');
            return;
        }
        
        // Save
        this.state.walletAddress = address;
        this.state.isWalletSaved = true;
        this.state.save();
        
        this.showWalletStatus('success', '✅ Anwani imehifadhiwa! ETC zitatumwa hapa.');
        this.updateUI();
    }

    showWalletStatus(type, message) {
        const status = this.elements.walletStatus;
        status.className = `wallet-status ${type}`;
        status.textContent = message;
        status.style.display = 'block';
        
        setTimeout(() => {
            status.style.display = 'none';
        }, 5000);
    }

    // ============================================
    // LEADERBOARD
    // ============================================
    async loadLeaderboard() {
        try {
            this.elements.leaderboardList.innerHTML = '<div class="loading-spinner">⏳ Inapakia...</div>';
            
            // Generate local leaderboard from localStorage
            const players = this.getLocalLeaderboard();
            
            if (players.length === 0) {
                this.elements.leaderboardList.innerHTML = '<div class="loading-spinner">🏆 Hakuna wachezaji bado</div>';
                return;
            }
            
            this.renderLeaderboard(players);
        } catch (error) {
            console.error('Error loading leaderboard:', error);
            this.elements.leaderboardList.innerHTML = '<div class="loading-spinner">❌ Imeshindwa kupakia</div>';
        }
    }

    getLocalLeaderboard() {
        // Get all game states from localStorage
        const players = [];
        
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('ecoin_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && data.balance !== undefined) {
                        players.push({
                            name: data.userName || 'Mchezaji',
                            balance: data.balance || 0,
                            taps: data.totalTaps || 0
                        });
                    }
                } catch (e) {}
            }
        }
        
        // Sort by balance descending
        players.sort((a, b) => b.balance - a.balance);
        return players.slice(0, 10);
    }

    renderLeaderboard(players) {
        this.elements.leaderboardList.innerHTML = players.map((player, index) => {
            const rankClass = index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : '';
            const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            
            return `
                <div class="leaderboard-item ${rankClass}">
                    <span class="rank">${rankEmoji}</span>
                    <span class="name">${this.escapeHtml(player.name)}</span>
                    <span class="points">${player.balance.toFixed(1)} ETC</span>
                </div>
            `;
        }).join('');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ============================================
    // TELEGRAM INTEGRATION
    // ============================================
    setupTelegramMainButton() {
        tg.MainButton.setText('📊 Takwimu Zangu');
        tg.MainButton.show();
        
        tg.MainButton.onClick(() => {
            const etcAmount = this.state.balance * 0.01;
            const isEligible = this.state.balance >= TOKENOMICS.DISTRIBUTION_THRESHOLD;
            
            tg.showAlert(`
📊 TAKWIMU ZAKO
━━━━━━━━━━━━━━━━━
💰 Salio: ${this.state.balance.toFixed(3)} pointi
💎 ETC: ${etcAmount.toFixed(4)} ETC
🏆 Ngazi: ${this.state.level}
👆 Taps: ${this.state.totalTaps}
⚡ Multiplier: ${this.state.multiplier.toFixed(2)}x
🔑 Wallet: ${this.state.isWalletSaved ? this.state.walletAddress.substring(0, 8) + '...' + this.state.walletAddress.substring(38) : '❌ Hujahifadhi'}
━━━━━━━━━━━━━━━━━
🎯 Hali: ${isEligible ? '✅ Unastahiki ETC!' : `⚠️ Unahitaji ${TOKENOMICS.DISTRIBUTION_THRESHOLD} pointi`}
📈 Maendeleo: ${((this.state.balance / TOKENOMICS.DISTRIBUTION_THRESHOLD) * 100).toFixed(0)}%
━━━━━━━━━━━━━━━━━
🏷️ Total Supply: ${TOKENOMICS.TOTAL_SUPPLY} ETC
🔒 Ulinzi: Imewashwa
            `);
        });
    }

    // ============================================
    // SHARE & INVITE
    // ============================================
    shareInvite() {
        const inviteLink = `https://t.me/YourBotName?start=${this.state.userId}`;
        if (tg.shareToStory) {
            tg.shareToStory(inviteLink);
        } else {
            navigator.clipboard.writeText(inviteLink).then(() => {
                this.showNotification('✅ Kiungo kimenakiliwa! Tuma kwa marafiki.');
            });
        }
    }

    // ============================================
    // DATA EXPORT (for backup)
    // ============================================
    exportData() {
        const data = {
            state: this.state,
            version: '2.1.0',
            exportDate: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ecoin_backup_${this.state.userId}_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// ============================================
// INITIALIZE APPLICATION
// ============================================
let app;

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
    app = new ECoinApp();
});

// Handle visibility change (save on tab switch)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && app) {
        app.state.save();
    }
});

// Handle beforeunload (save on close)
window.addEventListener('beforeunload', () => {
    if (app) {
        app.state.save();
    }
});

// ============================================
// EXPOSE FOR DEBUGGING
// ============================================
window.__ECoin = {
    app,
    TOKENOMICS,
    version: '2.1.0',
    debug: () => console.log('ECoin App:', app?.state)
};

console.log('🚀 ECoin Tap-to-Earn v2.1.0');
console.log('🔒 Anti-Cheat: Active');
console.log(`💰 Total Supply: ${TOKENOMICS.TOTAL_SUPPLY} ETC`);
