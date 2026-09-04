/**
 * ============================================
 * ECoin Tap-to-Earn - Main Application
 * Version: 2.1.0
 * Security Level: HIGH
 * ============================================
 */

// ============================================
// TOKENOMICS ENGINE
// ============================================
const Tokenomics = {
    TOTAL_SUPPLY: 1000000,           // 1,000,000 ETC max
    TAP_RATE: 0.001,                 // 0.001 ETC per tap (1000 taps = 1 ETC)
    MAX_TAPS_PER_DAY: 5000,          // Daily limit
    ENERGY_MAX: 100,
    ENERGY_REGEN_RATE: 1,            // Per 3 seconds
    ENERGY_COST: 1,
    LEVEL_UP_THRESHOLD: 100,         // Taps per level
    MULTIPLIER_PER_LEVEL: 0.05,      // 5% per level
    COOLDOWN_MS: 150,                // Between taps
    MAX_TAPS_PER_SECOND: 5,          // Anti-cheat
    DISTRIBUTION_THRESHOLD: 100,     // Minimum points for airdrop
    DAILY_RESET_HOUR: 0,             // 12 AM UTC
};

// ============================================
// TELEGRAM INIT
// ============================================
const tg = window.Telegram.WebApp;
tg.expand();

// ============================================
// GAME STATE
// ============================================
class GameState {
    constructor() {
        this.userId = tg.initDataUnsafe?.user?.id || 'anonymous_' + Date.now();
        this.userName = tg.initDataUnsafe?.user?.first_name || 'Mchezaji';
        this.userEmoji = this.getRandomEmoji();
        
        // Game data
        this.balance = 0;
        this.totalTaps = 0;
        this.todayTaps = 0;
        this.level = 1;
        this.energy = Tokenomics.ENERGY_MAX;
        this.multiplier = 1.0;
        
        // Wallet
        this.walletAddress = '';
        this.isWalletSaved = false;
        
        // Timestamps
        this.lastTapTime = 0;
        this.lastSaveTime = Date.now();
        this.todayDate = new Date().toDateString();
        this.totalDistributed = 0;
        
        // Anti-cheat
        this.tapTimestamps = [];
        this.suspiciousCount = 0;
        this.isSuspicious = false;
        
        // Initialized flag
        this.isInitialized = false;
    }

    getRandomEmoji() {
        const emojis = ['🦊', '🐺', '🐉', '🦄', '🐱', '🦁', '🐼', '🐨', '🦅', '🐬', '🦋', '🌈'];
        return emojis[Math.floor(Math.random() * emojis.length)];
    }

    load() {
        try {
            // Try primary storage (localStorage)
            const saved = localStorage.getItem('ecoin_state');
            if (saved) {
                const data = JSON.parse(saved);
                Object.assign(this, data);
                
                // Check if new day
                const today = new Date().toDateString();
                if (this.todayDate !== today) {
                    this.todayTaps = 0;
                    this.todayDate = today;
                }
                
                // Regenerate energy since last save
                const elapsed = (Date.now() - this.lastSaveTime) / 1000;
                const regen = Math.floor(elapsed / 3) * Tokenomics.ENERGY_REGEN_RATE;
                this.energy = Math.min(this.energy + regen, Tokenomics.ENERGY_MAX);
                
                this.isInitialized = true;
                return true;
            }
        } catch (e) {
            console.warn('Load error:', e);
        }
        return false;
    }

    save() {
        try {
            this.lastSaveTime = Date.now();
            const data = JSON.stringify(this);
            localStorage.setItem('ecoin_state', data);
            
            // Backup to Telegram CloudStorage
            if (tg.CloudStorage) {
                tg.CloudStorage.setItem('ecoin_state', data, (err) => {
                    if (err) console.warn('CloudStorage save failed');
                });
            }
            return true;
        } catch (e) {
            console.warn('Save error:', e);
            return false;
        }
    }

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
                    this.isInitialized = true;
                    resolve(true);
                } catch (e) {
                    resolve(false);
                }
            });
        });
    }

    // Reset daily if needed
    checkDailyReset() {
        const today = new Date().toDateString();
        if (this.todayDate !== today) {
            this.todayTaps = 0;
            this.todayDate = today;
            this.save();
        }
    }
}

// ============================================
// ANTI-CHEAT SYSTEM
// ============================================
class AntiCheat {
    constructor() {
        this.tapWindow = [];
        this.windowSize = 10;
        this.windowMs = 1000;
        this.maxTaps = Tokenomics.MAX_TAPS_PER_SECOND;
        this.consecutiveViolations = 0;
        this.isLocked = false;
        this.lockUntil = 0;
    }

    validateTap(timestamp) {
        // Check if locked
        if (this.isLocked && Date.now() < this.lockUntil) {
            return { valid: false, reason: 'locked' };
        }
        if (this.isLocked) {
            this.isLocked = false;
            this.consecutiveViolations = 0;
        }

        // Clean old timestamps
        const cutoff = timestamp - this.windowMs;
        this.tapWindow = this.tapWindow.filter(t => t > cutoff);
        
        // Check rate limit
        if (this.tapWindow.length >= this.maxTaps) {
            this.consecutiveViolations++;
            
            // Lock if too many violations
            if (this.consecutiveViolations >= 3) {
                this.isLocked = true;
                this.lockUntil = Date.now() + 5000; // 5 second lock
                return { valid: false, reason: 'locked' };
            }
            
            return { valid: false, reason: 'rate_limit' };
        }
        
        // Check for automation patterns (too consistent timing)
        if (this.tapWindow.length >= 3) {
            const intervals = [];
            for (let i = 1; i < this.tapWindow.length; i++) {
                intervals.push(this.tapWindow[i] - this.tapWindow[i-1]);
            }
            
            // If all intervals are nearly identical (within 10ms), suspicious
            const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const allSame = intervals.every(i => Math.abs(i - avg) < 10);
            
            if (allSame && intervals.length >= 3) {
                return { valid: false, reason: 'automation_detected' };
            }
        }
        
        // Valid tap
        this.tapWindow.push(timestamp);
        this.consecutiveViolations = Math.max(0, this.consecutiveViolations - 1);
        return { valid: true };
    }

    reset() {
        this.tapWindow = [];
        this.consecutiveViolations = 0;
        this.isLocked = false;
        this.lockUntil = 0;
    }
}

// ============================================
// MAIN APPLICATION
// ============================================
class ECoinApp {
    constructor() {
        this.state = new GameState();
        this.antiCheat = new AntiCheat();
        this.elements = {};
        this.isProcessing = false;
        this._saveTimeout = null;
        this._leaderboardTimeout = null;
        
        this.init();
    }

    init() {
        // Load state
        const loaded = this.state.load();
        if (!loaded) {
            this.state.loadFromCloud().then(() => {
                this.state.save();
                this.updateUI();
            });
        }
        
        // Cache DOM elements
        this.cacheElements();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Start energy regeneration
        this.startEnergyRegeneration();
        
        // Setup auto-save
        this.setupAutoSave();
        
        // Load leaderboard
        this.loadLeaderboard();
        
        // Setup Telegram Main Button
        this.setupTelegramMainButton();
        
        // Initialize UI
        this.updateUI();
        
        // Check daily reset
        this.state.checkDailyReset();
        
        // Log security status
        console.log('🔒 ECoin Tap v2.1.0');
        console.log(`💰 Total Supply: ${Tokenomics.TOTAL_SUPPLY} ETC`);
        console.log(`⚡ Tap Rate: ${Tokenomics.TAP_RATE} ETC/tap`);
        console.log(`👤 User: ${this.state.userName}`);
        console.log('✅ Anti-Cheat: ACTIVE');
    }

    cacheElements() {
        this.elements = {
            // Header
            userName: document.getElementById('userName'),
            userEmoji: document.getElementById('userEmoji'),
            levelBadge: document.getElementById('levelBadge'),
            tokenPrice: document.getElementById('tokenPrice'),
            
            // Balance
            balance: document.getElementById('balance'),
            balanceChange: document.getElementById('balanceChange'),
            progressFill: document.getElementById('progressFill'),
            progressLabel: document.getElementById('progressLabel'),
            
            // Energy
            energyFill: document.getElementById('energyFill'),
            energyText: document.getElementById('energyText'),
            
            // Tap
            tapButton: document.getElementById('tapButton'),
            tapReward: document.getElementById('tapReward'),
            todayTaps: document.getElementById('todayTaps'),
            multiplierDisplay: document.getElementById('multiplierDisplay'),
            totalTapsDisplay: document.getElementById('totalTapsDisplay'),
            
            // Wallet
            walletInput: document.getElementById('walletInput'),
            saveWalletBtn: document.getElementById('saveWalletBtn'),
            walletStatus: document.getElementById('walletStatus'),
            
            // Stats
            levelDisplay: document.getElementById('levelDisplay'),
            playerCount: document.getElementById('playerCount'),
            distributedDisplay: document.getElementById('distributedDisplay'),
            pointsDisplay: document.getElementById('pointsDisplay'),
            totalSupplyDisplay: document.getElementById('totalSupplyDisplay'),
            
            // Leaderboard
            leaderboardList: document.getElementById('leaderboardList'),
            refreshLeaderboard: document.getElementById('refreshLeaderboard'),
            
            // Share
            shareBtn: document.getElementById('shareBtn'),
        };
    }

    setupEventListeners() {
        // Tap button
        this.elements.tapButton.addEventListener('click', (e) => this.handleTap(e));
        this.elements.tapButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleTap(e);
        }, { passive: false });
        
        // Wallet
        this.elements.walletInput.addEventListener('input', () => this.validateWalletInput());
        this.elements.saveWalletBtn.addEventListener('click', () => this.saveWallet());
        
        // Leaderboard refresh
        this.elements.refreshLeaderboard.addEventListener('click', () => this.loadLeaderboard());
        
        // Share button
        this.elements.shareBtn.addEventListener('click', () => this.shareInvite());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault();
                this.handleTap(e);
            }
        });
        
        // Visibility change - save on tab switch
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.state.save();
            }
        });
        
        // Before unload - save
        window.addEventListener('beforeunload', () => {
            this.state.save();
        });
    }

    // ============================================
    // TAP HANDLING
    // ============================================
    handleTap(event) {
        // Prevent double processing
        if (this.isProcessing) return;
        
        const now = Date.now();
        
        // Check energy
        if (this.state.energy < Tokenomics.ENERGY_COST) {
            this.showNotification('⚡ Nishati imeisha! Subiri ijaze.');
            return;
        }
        
        // Check daily limit
        if (this.state.todayTaps >= Tokenomics.MAX_TAPS_PER_DAY) {
            this.showNotification('📊 Umefikia kikomo cha taps leo! Rudi kesho.');
            return;
        }
        
        // Anti-cheat validation
        const validation = this.antiCheat.validateTap(now);
        if (!validation.valid) {
            if (validation.reason === 'locked') {
                this.showNotification('⛔ Ulinzi umewashwa! Subiri sekunde chache.');
                this.elements.tapButton.classList.add('disabled');
                setTimeout(() => {
                    this.elements.tapButton.classList.remove('disabled');
                }, 5000);
            } else if (validation.reason === 'rate_limit') {
                this.showNotification('⚠️ Tafadhali pumzika! Unagusa haraka sana.');
            } else if (validation.reason === 'automation_detected') {
                this.showNotification('🚫 Mfumo wa auto-clicker umegunduliwa!');
                this.elements.tapButton.classList.add('disabled');
                setTimeout(() => {
                    this.elements.tapButton.classList.remove('disabled');
                }, 10000);
            }
            return;
        }
        
        // Process tap
        this.isProcessing = true;
        this.processTap(now);
        this.isProcessing = false;
    }

    processTap(timestamp) {
        // Deduct energy
        this.state.energy -= Tokenomics.ENERGY_COST;
        
        // Calculate reward with multiplier
        const baseReward = Tokenomics.TAP_RATE;
        const multiplier = 1 + (this.state.level - 1) * Tokenomics.MULTIPLIER_PER_LEVEL;
        const reward = baseReward * multiplier;
        
        // Update state
        this.state.balance += reward;
        this.state.totalTaps += 1;
        this.state.todayTaps += 1;
        this.state.multiplier = multiplier;
        
        // Check level up
        const newLevel = Math.floor(this.state.totalTaps / Tokenomics.LEVEL_UP_THRESHOLD) + 1;
        if (newLevel > this.state.level) {
            this.state.level = newLevel;
            this.showNotification(`🎉 Ngazi ${newLevel}! Multiplier +${(Tokenomics.MULTIPLIER_PER_LEVEL * 100).toFixed(0)}%`);
        }
        
        // Update UI
        this.updateUI();
        this.showTapEffect(reward);
        this.animateTapButton();
        
        // Haptic feedback
        if (tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('light');
        }
        
        // Auto-save
        this.debounceSave();
    }

    // ============================================
    // UI UPDATES
    // ============================================
    updateUI() {
        // Balance
        this.elements.balance.textContent = this.state.balance.toFixed(3);
        
        // Balance change animation
        const changeEl = this.elements.balanceChange;
        changeEl.textContent = `+${Tokenomics.TAP_RATE.toFixed(3)}`;
        changeEl.classList.add('show');
        setTimeout(() => changeEl.classList.remove('show'), 1000);
        
        // Energy
        const energyPercent = (this.state.energy / Tokenomics.ENERGY_MAX) * 100;
        this.elements.energyFill.style.width = `${energyPercent}%`;
        this.elements.energyText.textContent = `${Math.floor(this.state.energy)} / ${Tokenomics.ENERGY_MAX}`;
        
        // Progress
        const tapsInLevel = this.state.totalTaps % Tokenomics.LEVEL_UP_THRESHOLD;
        const progress = (tapsInLevel / Tokenomics.LEVEL_UP_THRESHOLD) * 100;
        this.elements.progressFill.style.width = `${progress}%`;
        this.elements.progressLabel.textContent = `${progress.toFixed(0)}% hadi Ngazi ${this.state.level + 1}`;
        
        // Stats
        this.elements.todayTaps.textContent = this.state.todayTaps;
        this.elements.multiplierDisplay.textContent = `${this.state.multiplier.toFixed(2)}x`;
        this.elements.totalTapsDisplay.textContent = this.state.totalTaps.toLocaleString();
        this.elements.levelDisplay.textContent = this.state.level;
        this.elements.levelBadge.textContent = this.state.level;
        this.elements.pointsDisplay.textContent = this.state.balance.toFixed(1);
        
        // Tap reward
        const reward = Tokenomics.TAP_RATE * this.state.multiplier;
        this.elements.tapReward.textContent = `+${reward.toFixed(3)}`;
        
        // Wallet
        if (this.state.isWalletSaved) {
            this.elements.walletInput.value = this.state.walletAddress;
            this.elements.walletInput.disabled = true;
            this.elements.saveWalletBtn.classList.add('saved');
            this.elements.saveWalletBtn.querySelector('.btn-text').textContent = 'Imeshahifadhiwa';
        }
        
        // User
        this.elements.userName.textContent = this.state.userName;
        this.elements.userEmoji.textContent = this.state.userEmoji;
        
        // Total supply
        this.elements.totalSupplyDisplay.textContent = Tokenomics.TOTAL_SUPPLY.toLocaleString();
        
        // Document title
        document.title = `💰 ${this.state.balance.toFixed(1)} ETC - ECoin Tap`;
    }

    // ============================================
    // VISUAL EFFECTS
    // ============================================
    animateTapButton() {
        const btn = this.elements.tapButton;
        btn.style.transform = 'scale(0.92)';
        setTimeout(() => {
            btn.style.transform = 'scale(1)';
        }, 100);
    }

    showTapEffect(reward) {
        // Floating text
        const text = document.createElement('div');
        text.className = 'float-text';
        text.textContent = `+${reward.toFixed(3)}`;
        text.style.left = `${window.innerWidth / 2 - 40}px`;
        text.style.top = `${window.innerHeight / 2 - 120}px`;
        document.body.appendChild(text);
        setTimeout(() => text.remove(), 1000);
    }

    showNotification(message) {
        if (tg.showAlert) {
            tg.showAlert(message);
        } else {
            // Fallback
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 12px 24px;
                border-radius: 12px;
                font-size: 14px;
                z-index: 9999;
                max-width: 90%;
                text-align: center;
                animation: fadeIn 0.3s ease;
            `;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
    }

    // ============================================
    // ENERGY REGENERATION
    // ============================================
    startEnergyRegeneration() {
        setInterval(() => {
            if (this.state.energy < Tokenomics.ENERGY_MAX) {
                this.state.energy = Math.min(
                    this.state.energy + Tokenomics.ENERGY_REGEN_RATE,
                    Tokenomics.ENERGY_MAX
                );
                this.updateUI();
            }
        }, 3000);
    }

    // ============================================
    // AUTO-SAVE
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
        }, 30000);
    }

    // ============================================
    // WALLET MANAGEMENT
    // ============================================
    validateWalletInput() {
        const address = this.elements.walletInput.value.trim();
        
        if (address.length === 0) {
            this.elements.walletInput.className = 'wallet-input';
            return;
        }
        
        const isValid = this.isValidEthereumAddress(address);
        this.elements.walletInput.className = `wallet-input ${isValid ? 'valid' : 'invalid'}`;
    }

    isValidEthereumAddress(address) {
        return /^0x[a-fA-F0-9]{40}$/.test(address);
    }

    saveWallet() {
        const address = this.elements.walletInput.value.trim();
        
        // Validate
        if (!this.isValidEthereumAddress(address)) {
            this.showWalletStatus('error', '❌ Anwani batili! Inatakiwa ianze na "0x" na iwe na herufi 42.');
            return;
        }
        
        // Save
        this.state.walletAddress = address;
        this.state.isWalletSaved = true;
        this.state.save();
        
        this.showWalletStatus('success', '✅ Anwani imehifadhiwa! ETC zitatumwa hapa siku ya airdrop.');
        this.updateUI();
        
        // Send wallet to bot via Telegram
        this.sendWalletToBot(address);
    }

    showWalletStatus(type, message) {
        const status = this.elements.walletStatus;
        status.className = `wallet-status ${type}`;
        status.textContent = message;
        status.style.display = 'block';
        
        setTimeout(() => {
            status.style.display = 'none';
        }, 6000);
    }

    // ============================================
    // SEND WALLET TO TELEGRAM BOT
    // ============================================
    sendWalletToBot(address) {
        // Method 1: Using Telegram WebApp sendData
        if (tg.sendData) {
            const data = JSON.stringify({
                action: 'save_wallet',
                userId: this.state.userId,
                userName: this.state.userName,
                wallet: address,
                balance: this.state.balance,
                timestamp: new Date().toISOString()
            });
            tg.sendData(data);
            console.log('📤 Wallet sent to bot via sendData');
        }
        
        // Method 2: Store in localStorage for batch collection
        this.collectWalletData(address);
    }

    collectWalletData(address) {
        // Store in a dedicated key for easy collection
        const wallets = JSON.parse(localStorage.getItem('ecoin_wallets') || '[]');
        
        // Check if already exists
        const exists = wallets.find(w => w.userId === this.state.userId);
        if (!exists) {
            wallets.push({
                userId: this.state.userId,
                userName: this.state.userName,
                wallet: address,
                balance: this.state.balance,
                totalTaps: this.state.totalTaps,
                savedAt: new Date().toISOString()
            });
            localStorage.setItem('ecoin_wallets', JSON.stringify(wallets));
            console.log('📊 Wallet data collected:', wallets.length, 'wallets');
        }
    }

    // ============================================
    // GET ALL WALLETS (For Airdrop)
    // ============================================
    getAllWallets() {
        try {
            const data = localStorage.getItem('ecoin_wallets');
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    exportWalletsForAirdrop() {
        const wallets = this.getAllWallets();
        const eligible = wallets.filter(w => w.balance >= Tokenomics.DISTRIBUTION_THRESHOLD);
        
        // Format for airdrop
        const airdropData = eligible.map(w => ({
            address: w.wallet,
            userId: w.userId,
            userName: w.userName,
            etcAmount: (w.balance * Tokenomics.TAP_RATE).toFixed(4),
            points: w.balance
        }));
        
        // Download as CSV/JSON
        const blob = new Blob([JSON.stringify(airdropData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `airdrop_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        return airdropData;
    }

    // ============================================
    // LEADERBOARD
    // ============================================
    loadLeaderboard() {
        try {
            const players = this.getLeaderboardData();
            this.renderLeaderboard(players);
        } catch (e) {
            console.error('Leaderboard error:', e);
        }
    }

    getLeaderboardData() {
        const players = [];
        
        // Get current user
        players.push({
            userId: this.state.userId,
            userName: this.state.userName,
            balance: this.state.balance,
            totalTaps: this.state.totalTaps,
            isCurrentUser: true
        });
        
        // Get from localStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('ecoin_state_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && data.userId !== this.state.userId) {
                        players.push({
                            userId: data.userId,
                            userName: data.userName || 'Mchezaji',
                            balance: data.balance || 0,
                            totalTaps: data.totalTaps || 0,
                            isCurrentUser: false
                        });
                    }
                } catch (e) {}
            }
        }
        
        // Also check main state in localStorage
        const mainState = localStorage.getItem('ecoin_state');
        if (mainState) {
            try {
                const data = JSON.parse(mainState);
                // Check if current user is already in list
                const exists = players.find(p => p.userId === data.userId);
                if (!exists && data.userId !== this.state.userId) {
                    players.push({
                        userId: data.userId,
                        userName: data.userName || 'Mchezaji',
                        balance: data.balance || 0,
                        totalTaps: data.totalTaps || 0,
                        isCurrentUser: false
                    });
                }
            } catch (e) {}
        }
        
        // Sort by balance descending
        players.sort((a, b) => b.balance - a.balance);
        return players.slice(0, 20);
    }

    renderLeaderboard(players) {
        const list = this.elements.leaderboardList;
        
        if (!players || players.length === 0) {
            list.innerHTML = `
                <div class="loading-state">
                    <span>🏆</span>
                    <span>Hakuna wachezaji bado</span>
                </div>
            `;
            return;
        }
        
        // Update player count
        this.elements.playerCount.textContent = players.length;
        
        list.innerHTML = players.map((player, index) => {
            const rankClass = index === 0 ? 'gold' : index === 1 ? 'silver' : index === 2 ? 'bronze' : '';
            const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            const isYou = player.isCurrentUser ? '⭐ ' : '';
            
            return `
                <div class="leaderboard-item" style="animation-delay: ${index * 0.05}s">
                    <span class="rank ${rankClass}">${rankEmoji}</span>
                    <span class="name">${isYou}${this.escapeHtml(player.userName)}</span>
                    <span class="points">${player.balance.toFixed(1)} ETC</span>
                    <span class="taps">${player.totalTaps} taps</span>
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
    // SHARE & INVITE
    // ============================================
    shareInvite() {
        const inviteLink = `https://t.me/share/url?url=🎮%20ECoin%20Tap-to-Earn!%20Pata%20ETC%20kwa%20kugusa!%0A%0A👤%20Mwaliko%20kutoka%3A%20${encodeURIComponent(this.state.userName)}%0A💰%20Pointi%3A%20${this.state.balance.toFixed(1)}%0A🏆%20Ngazi%3A%20${this.state.level}%0A%0A🚀%20Anza%20sasa%3A%20https://t.me/YourBotName`;
        
        if (tg.openLink) {
            tg.openLink(inviteLink);
        } else {
            navigator.clipboard.writeText(inviteLink).then(() => {
                this.showNotification('✅ Kiungo kimenakiliwa! Tuma kwa marafiki.');
            });
        }
    }

    // ============================================
    // TELEGRAM INTEGRATION
    // ============================================
    setupTelegramMainButton() {
        tg.MainButton.setText('📊 Takwimu Zangu');
        tg.MainButton.show();
        
        tg.MainButton.onClick(() => {
            const etcAmount = this.state.balance * Tokenomics.TAP_RATE;
            const isEligible = this.state.balance >= Tokenomics.DISTRIBUTION_THRESHOLD;
            const walletStatus = this.state.isWalletSaved ? 
                this.state.walletAddress.substring(0, 8) + '...' + this.state.walletAddress.substring(38) : 
                '❌ Hujahifadhi';
            
            tg.showAlert(`
📊 TAKWIMU ZAKO
━━━━━━━━━━━━━━━━━
💰 Salio: ${this.state.balance.toFixed(3)} pointi
💎 ETC: ${etcAmount.toFixed(4)} ETC
🏆 Ngazi: ${this.state.level}
👆 Taps: ${this.state.totalTaps}
⚡ Multiplier: ${this.state.multiplier.toFixed(2)}x
🔑 Wallet: ${walletStatus}
━━━━━━━━━━━━━━━━━
🎯 Hali: ${isEligible ? '✅ Unastahiki ETC!' : `⚠️ Unahitaji ${Tokenomics.DISTRIBUTION_THRESHOLD} pointi`}
📈 Maendeleo: ${((this.state.balance / Tokenomics.DISTRIBUTION_THRESHOLD) * 100).toFixed(0)}%
━━━━━━━━━━━━━━━━━
🏷️ Total Supply: ${Tokenomics.TOTAL_SUPPLY} ETC
🔒 Ulinzi: Imewashwa
            `);
        });
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================
    // Expose for debugging and admin
    getState() {
        return this.state;
    }

    resetGame() {
        if (confirm('Je, una uhakika unataka kuanzisha upya mchezo? Data yote itafutwa.')) {
            localStorage.removeItem('ecoin_state');
            localStorage.removeItem('ecoin_wallets');
            this.state = new GameState();
            this.antiCheat.reset();
            this.updateUI();
            this.showNotification('✅ Mchezo umeanzishwa upya');
        }
    }

    exportData() {
        const data = {
            state: this.state,
            wallets: this.getAllWallets(),
            leaderboard: this.getLeaderboardData(),
            exportDate: new Date().toISOString(),
            version: '2.1.0'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ecoin_data_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// ============================================
// INITIALIZE
// ============================================
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new ECoinApp();
});

// ============================================
// EXPOSE FOR DEBUGGING
// ============================================
window.__ECoin = {
    app: () => app,
    Tokenomics,
    version: '2.1.0',
    exportWallets: () => app?.exportWalletsForAirdrop(),
    getState: () => app?.getState(),
    getAllWallets: () => app?.getAllWallets(),
    reset: () => app?.resetGame(),
    exportData: () => app?.exportData(),
    debug: () => {
        if (app) {
            console.log('=== ECoin Debug ===');
            console.log('State:', app.state);
            console.log('Wallets:', app.getAllWallets());
            console.log('Leaderboard:', app.getLeaderboardData());
            console.log('AntiCheat:', app.antiCheat);
        } else {
            console.log('⏳ App not initialized yet');
        }
    }
};

console.log('🚀 ECoin Tap v2.1.0 Loaded');
console.log('🔧 Use __ECoin.debug() for debugging');
console.log('📤 Use __ECoin.exportWallets() for airdrop data');
