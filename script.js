class RurumMessenger {
    constructor() {
        this.chats = [];
        this.friends = [];
        this.currentChat = null;
        this.isInitialized = false;
        this.currentUser = {
            id: 'user_' + Date.now(),
            fullName: 'Пользователь',
            avatar: 'П',
            avatarColor: '#f6a75e',
            avatarImage: null,
            status: 'online',
            theme: 'light'
        };
        this.usedNames = new Set(['Пользователь']);
        
        // Ably настройки - ВАШ КЛЮЧ УЖЕ ВСТАВЛЕН
        this.ably = null;
        this.channel = null;
        this.ABLY_API_KEY = 'AcL67w.nyZ_5A:J4JyAk0k9idP-77-GRCp6No-lbfpF2UG0peFaC-9qSg';
        
        // Временное хранилище сообщений
        this.messages = new Map();
    }

    init() {
        if (this.isInitialized) return;
        
        console.log('💬 Messenger initializing...');
        this.loadFromStorage();
        this.bindEvents();
        this.renderChatsList();
        this.renderFriendsList();
        this.setupMobileNavigation();
        this.updateUserInterface();
        
        // Инициализируем Ably
        this.initAbly();
        
        // Запрашиваем разрешение на уведомления
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
        
        this.isInitialized = true;
        console.log('✅ Messenger initialized with Ably');
    }

    initAbly() {
        try {
            console.log('🔌 Initializing Ably with key:', this.ABLY_API_KEY.substring(0, 10) + '...');
            
            // Инициализация Ably
            this.ably = new Ably.Realtime(this.ABLY_API_KEY);
            
            this.ably.connection.on('connected', () => {
                console.log('✅ Connected to Ably');
                this.showMessage('Подключено к серверу', 'success');
            });
            
            this.ably.connection.on('disconnected', () => {
                console.warn('⚠️ Disconnected from Ably');
                this.showMessage('Потеряно соединение с сервером', 'warning');
            });
            
            this.ably.connection.on('failed', () => {
                console.error('❌ Failed to connect to Ably');
                this.showMessage('Ошибка подключения к серверу', 'error');
            });
            
            this.ably.connection.on('suspended', () => {
                console.warn('⏸️ Ably connection suspended');
                this.showMessage('Соединение приостановлено', 'warning');
            });
            
        } catch (error) {
            console.error('❌ Error initializing Ably:', error);
            this.showMessage('Ошибка инициализации Ably', 'error');
        }
    }

    setupChatRealtime(chatId) {
        if (!this.ably) {
            console.warn('⚠️ Ably not initialized');
            this.showMessage('Сервер не подключен', 'warning');
            return;
        }
        
        // Отписываемся от предыдущего канала
        if (this.channel) {
            this.channel.unsubscribe();
        }
        
        // Подключаемся к каналу чата
        this.channel = this.ably.channels.get(`chat:${chatId}`);
        
        // Подписываемся на сообщения
        this.channel.subscribe('message', (message) => {
            console.log('📨 New message received from Ably:', message.data);
            this.handleIncomingMessage(message.data, chatId);
        });
        
        // Загружаем историю сообщений
        this.loadChannelHistory(chatId);
        
        console.log(`🎧 Connected to Ably channel: chat:${chatId}`);
    }

    async loadChannelHistory(chatId) {
        try {
            if (!this.channel) return;
            
            // Получаем последние 50 сообщений из Ably
            const historyPage = await this.channel.history({ limit: 50 });
            const ablyMessages = historyPage.items
                .map(item => item.data.message)
                .filter(msg => msg)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            // Объединяем с локальными сообщениями
            const localMessages = this.messages.get(chatId) || [];
            const allMessages = [...localMessages, ...ablyMessages];
            
            // Удаляем дубликаты по ID
            const uniqueMessages = [];
            const seenIds = new Set();
            
            for (const msg of allMessages) {
                if (!seenIds.has(msg.id)) {
                    seenIds.add(msg.id);
                    uniqueMessages.push(msg);
                }
            }
            
            // Сортируем по времени
            uniqueMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            // Сохраняем
            this.messages.set(chatId, uniqueMessages);
            
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages();
                this.scrollToBottom();
            }
            
        } catch (error) {
            console.error('❌ Error loading history from Ably:', error);
        }
    }

    handleIncomingMessage(messageData, chatId) {
        const { message, sender } = messageData;
        
        if (!message) return;
        
        console.log('📩 Processing incoming message:', message);
        
        // Добавляем сообщение в чат
        if (!this.messages.has(chatId)) {
            this.messages.set(chatId, []);
        }
        
        // Проверяем, нет ли уже такого сообщения
        const existingMessage = this.messages.get(chatId).find(m => m.id === message.id);
        if (!existingMessage) {
            this.messages.get(chatId).push(message);
        }
        
        // Если это текущий открытый чат - обновляем интерфейс
        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages();
            this.scrollToBottom();
        } else {
            // Показываем уведомление для другого чата
            const chat = this.chats.find(c => c.id === chatId);
            if (chat) {
                chat.unread = (chat.unread || 0) + 1;
                this.renderChatsList();
                this.showNotification(`Новое сообщение от ${sender}`, message.text);
            }
        }
    }

    showNotification(title, message) {
        // Проверяем разрешение на уведомления
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body: message });
        }
        
        // Показываем в интерфейсе
        this.showMessage(`Новое сообщение: ${message.substring(0, 30)}...`, 'info');
    }

    bindEvents() {
        console.log('🔗 Binding messenger events...');
        
        // Навигация
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.closest('.nav-btn').dataset.tab);
            });
        });

        // Кнопки в шапке
        const newChatBtn = document.querySelector('.new-chat-btn');
        if (newChatBtn) {
            newChatBtn.addEventListener('click', () => {
                this.showNewChatModal();
            });
        }

        const addFriendBtn = document.querySelector('.add-friend-btn');
        if (addFriendBtn) {
            addFriendBtn.addEventListener('click', () => {
                this.showAddFriendModal();
            });
        }

        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.showSettings();
            });
        }

        // Поиск
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
        }

        // Кнопки в пустых состояниях
        document.querySelectorAll('.start-chat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (e.target.closest('#chatsTab') || e.target.closest('.welcome-screen')) {
                    this.showNewChatModal();
                } else if (e.target.closest('#friendsTab')) {
                    this.showAddFriendModal();
                }
            });
        });

        // Модальные окна
        const createChatBtn = document.querySelector('.create-chat-btn');
        if (createChatBtn) {
            createChatBtn.addEventListener('click', () => {
                this.createNewChat();
            });
        }

        const cancelBtn = document.querySelector('.cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.hideNewChatModal();
            });
        }

        const addFriendConfirmBtn = document.querySelector('.add-friend-confirm-btn');
        if (addFriendConfirmBtn) {
            addFriendConfirmBtn.addEventListener('click', () => {
                this.addFriend();
            });
        }

        const cancelAddFriendBtn = document.querySelector('.cancel-add-friend-btn');
        if (cancelAddFriendBtn) {
            cancelAddFriendBtn.addEventListener('click', () => {
                this.hideAddFriendModal();
            });
        }

        const saveSettingsBtn = document.querySelector('.save-settings-btn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', () => {
                this.saveSettings();
            });
        }

        const cancelSettingsBtn = document.querySelector('.cancel-settings-btn');
        if (cancelSettingsBtn) {
            cancelSettingsBtn.addEventListener('click', () => {
                this.hideSettings();
            });
        }

        // Закрытие модальных окон
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                this.hideAllModals();
            });
        });

        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) {
                    this.hideAllModals();
                }
            });
        });

        // Отправка сообщений
        const sendBtn = document.querySelector('.send-btn');
        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                this.sendMessage();
            });
        }

        const messageInput = document.querySelector('.message-input');
        if (messageInput) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            messageInput.addEventListener('input', () => {
                this.autoResizeTextarea(messageInput);
            });
        }

        // Мобильная навигация
        const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
        if (mobileMenuToggle) {
            mobileMenuToggle.addEventListener('click', () => {
                this.toggleSidebar();
            });
        }

        const mobileBackBtn = document.querySelector('.mobile-back-btn');
        if (mobileBackBtn) {
            mobileBackBtn.addEventListener('click', () => {
                this.hideChat();
            });
        }

        // Аватар пользователя
        const userAvatarContainer = document.getElementById('userAvatarContainer');
        if (userAvatarContainer) {
            userAvatarContainer.addEventListener('click', () => {
                this.showSettings();
            });
        }

        // Загрузка аватара
        const avatarUploadBtn = document.querySelector('.avatar-upload-btn');
        if (avatarUploadBtn) {
            avatarUploadBtn.addEventListener('click', () => {
                document.getElementById('avatarUpload').click();
            });
        }

        const avatarUpload = document.getElementById('avatarUpload');
        if (avatarUpload) {
            avatarUpload.addEventListener('change', (e) => {
                this.handleAvatarUpload(e);
            });
        }

        // Цвета аватара
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => {
                this.selectAvatarColor(e.target);
            });
        });
    }

    toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.toggle('active');
        }
    }

    hideChat() {
        const activeChat = document.querySelector('.active-chat');
        const welcomeScreen = document.querySelector('.welcome-screen');
        const mobileHeader = document.querySelector('.mobile-chat-header');
        
        if (activeChat) activeChat.style.display = 'none';
        if (welcomeScreen) welcomeScreen.style.display = 'flex';
        if (mobileHeader) mobileHeader.style.display = 'none';
        
        this.currentChat = null;
        this.renderChatsList();
    }

    switchTab(tabName) {
        console.log(`📑 Switching to tab: ${tabName}`);
        
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.getElementById(`${tabName}Tab`).classList.add('active');
    }

    showNewChatModal() {
        console.log('📋 Showing new chat modal');
        const modal = document.getElementById('newChatModal');
        const chatNameInput = document.getElementById('chatNameInput');
        
        if (modal) {
            modal.style.display = 'flex';
        }
        if (chatNameInput) {
            chatNameInput.value = '';
            chatNameInput.focus();
        }
    }

    hideNewChatModal() {
        const modal = document.getElementById('newChatModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    createNewChat() {
        console.log('🆕 Creating new chat');
        const chatNameInput = document.getElementById('chatNameInput');
        if (!chatNameInput) return;

        const chatName = chatNameInput.value.trim();
        
        if (!chatName) {
            this.showMessage('Введите название беседы', 'error');
            return;
        }

        const newChat = {
            id: 'chat_' + Date.now(),
            name: chatName,
            messages: [],
            unread: 0,
            lastActivity: new Date(),
            created: new Date(),
            isFriendChat: false
        };

        this.chats.unshift(newChat);
        
        if (!this.messages.has(newChat.id)) {
            this.messages.set(newChat.id, []);
        }
        
        this.saveToStorage();
        this.renderChatsList();
        this.hideNewChatModal();
        this.openChat(newChat.id);
        
        this.showMessage(`Беседа "${chatName}" создана`, 'success');
    }

    showAddFriendModal() {
        console.log('👥 Showing add friend modal');
        const modal = document.getElementById('addFriendModal');
        const friendNameInput = document.getElementById('friendNameInput');
        
        if (modal) {
            modal.style.display = 'flex';
        }
        if (friendNameInput) {
            friendNameInput.value = '';
            friendNameInput.focus();
            this.clearValidationMessages();
        }
    }

    hideAddFriendModal() {
        const modal = document.getElementById('addFriendModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    addFriend() {
        console.log('👥 Adding friend...');
        const friendNameInput = document.getElementById('friendNameInput');
        if (!friendNameInput) return;

        const friendName = friendNameInput.value.trim();
        
        this.clearValidationMessages();
        
        if (!friendName) {
            this.showValidationMessage('Введите имя друга', 'error');
            return;
        }

        if (friendName.length < 2) {
            this.showValidationMessage('Имя должно содержать минимум 2 символа', 'error');
            return;
        }

        if (friendName.length > 20) {
            this.showValidationMessage('Имя не должно превышать 20 символов', 'error');
            return;
        }

        if (this.usedNames.has(friendName)) {
            this.showValidationMessage('Это имя уже используется', 'error');
            return;
        }

        if (friendName === this.currentUser.fullName) {
            this.showValidationMessage('Нельзя добавить себя в друзья', 'error');
            return;
        }

        const existingFriend = this.friends.find(friend => friend.name === friendName);
        if (existingFriend) {
            this.showValidationMessage('Этот друг уже добавлен', 'error');
            return;
        }

        const newFriend = {
            id: 'friend_' + Date.now(),
            name: friendName,
            avatar: friendName.charAt(0).toUpperCase(),
            avatarColor: this.getRandomColor(),
            status: 'online',
            lastSeen: new Date(),
            addedAt: new Date()
        };

        this.friends.unshift(newFriend);
        this.usedNames.add(friendName);
        
        this.saveToStorage();
        this.renderFriendsList();
        this.hideAddFriendModal();
        
        this.showMessage(`Друг "${friendName}" добавлен`, 'success');
        console.log('✅ Friend added:', friendName);
    }

    getRandomColor() {
        const colors = [
            '#f6a75e', '#FF6B6B', '#4ECDC4', '#45B7D1', 
            '#96CEB4', '#FFEAA7', '#DDA0DD', '#FFA07A'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    showValidationMessage(message, type) {
        const friendNameInput = document.getElementById('friendNameInput');
        if (!friendNameInput) return;

        this.clearValidationMessages();

        const messageEl = document.createElement('div');
        messageEl.className = `input-${type}`;
        messageEl.textContent = message;
        
        friendNameInput.parentNode.appendChild(messageEl);
    }

    clearValidationMessages() {
        const friendNameInput = document.getElementById('friendNameInput');
        if (!friendNameInput) return;

        const existingMessages = friendNameInput.parentNode.querySelectorAll('.input-error, .input-success');
        existingMessages.forEach(msg => msg.remove());
    }

    handleSearch(query) {
        const activeTab = document.querySelector('.tab-content.active').id;
        
        if (activeTab === 'chatsTab') {
            this.filterChats(query);
        } else if (activeTab === 'friendsTab') {
            this.filterFriends(query);
        }
    }

    filterChats(query) {
        const filteredChats = this.chats.filter(chat => 
            chat.name.toLowerCase().includes(query.toLowerCase())
        );
        this.renderChatsList(filteredChats);
    }

    filterFriends(query) {
        const filteredFriends = this.friends.filter(friend => 
            friend.name.toLowerCase().includes(query.toLowerCase())
        );
        this.renderFriendsList(filteredFriends);
    }

    setupMobileNavigation() {
        const menuToggle = document.querySelector('.mobile-menu-toggle');
        const sidebar = document.querySelector('.sidebar');
        
        if (menuToggle && sidebar) {
            menuToggle.addEventListener('click', () => {
                sidebar.classList.toggle('active');
            });
        }
        
        // Закрытие сайдбара при клике вне его на мобильных
        if (window.innerWidth <= 768) {
            document.addEventListener('click', (e) => {
                if (sidebar.classList.contains('active') && 
                    !e.target.closest('.sidebar') &&
                    !e.target.closest('.mobile-menu-toggle')) {
                    sidebar.classList.remove('active');
                }
            });
        }
    }

    showSettings() {
        console.log('⚙️ Showing settings');
        const modal = document.getElementById('settingsModal');
        if (modal) {
            document.getElementById('userNameInput').value = this.currentUser.fullName;
            document.getElementById('userStatusInput').value = this.currentUser.status || '';
            
            const themeRadios = document.getElementsByName('theme');
            themeRadios.forEach(radio => {
                radio.checked = radio.value === this.currentUser.theme;
            });

            this.updateAvatarPreview();
            
            document.querySelectorAll('.color-option').forEach(option => {
                if (option.dataset.color === this.currentUser.avatarColor) {
                    option.classList.add('active');
                } else {
                    option.classList.remove('active');
                }
            });

            modal.style.display = 'flex';
        }
    }

    hideSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    hideAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.style.display = 'none';
        });
    }

    saveSettings() {
        console.log('💾 Saving settings...');
        
        const userName = document.getElementById('userNameInput').value.trim();
        const userStatus = document.getElementById('userStatusInput').value.trim();
        const theme = document.querySelector('input[name="theme"]:checked').value;

        if (!userName) {
            this.showMessage('Введите имя пользователя', 'error');
            return;
        }

        if (userName !== this.currentUser.fullName) {
            if (this.usedNames.has(userName)) {
                this.showMessage('Это имя уже используется другим пользователем', 'error');
                return;
            }
            
            this.usedNames.delete(this.currentUser.fullName);
            this.usedNames.add(userName);
        }

        this.currentUser.fullName = userName;
        this.currentUser.status = userStatus;
        this.currentUser.theme = theme;
        this.currentUser.avatar = userName.charAt(0).toUpperCase();

        this.saveToStorage();
        this.updateUserInterface();
        this.hideSettings();
        this.showMessage('Настройки сохранены', 'success');
    }

    handleAvatarUpload(event) {
        const file = event.target.files[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                this.showMessage('Пожалуйста, выберите изображение', 'error');
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                this.showMessage('Размер файла не должен превышать 5MB', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                this.currentUser.avatarImage = e.target.result;
                this.currentUser.avatarColor = null;
                this.saveToStorage();
                this.updateUserInterface();
                this.updateAvatarPreview();
                this.showMessage('Аватар успешно загружен', 'success');
            };
            
            reader.onerror = () => {
                this.showMessage('Ошибка при загрузке изображения', 'error');
            };
            
            reader.readAsDataURL(file);
        }
    }

    selectAvatarColor(element) {
        const color = element.dataset.color;
        this.currentUser.avatarColor = color;
        this.currentUser.avatarImage = null;
        
        document.querySelectorAll('.color-option').forEach(option => {
            option.classList.remove('active');
        });
        element.classList.add('active');
        
        this.saveToStorage();
        this.updateUserInterface();
        this.updateAvatarPreview();
    }

    updateAvatarPreview() {
        const preview = document.getElementById('settingsAvatarPreview');
        if (preview) {
            if (this.currentUser.avatarImage) {
                preview.innerHTML = `<img src="${this.currentUser.avatarImage}" alt="Аватар" class="avatar-image large">`;
                preview.classList.add('has-image');
            } else {
                preview.textContent = this.currentUser.avatar;
                preview.style.background = this.currentUser.avatarColor;
                preview.classList.remove('has-image');
            }
        }
    }

    updateUserInterface() {
        console.log('🎨 Updating UI...');

        const userNameElements = document.querySelectorAll('#userName, #footerUserName');
        userNameElements.forEach(el => {
            if (el) {
                el.textContent = this.currentUser.fullName;
            }
        });

        this.updateAvatarElement('userAvatar');
        this.updateAvatarElement('footerUserAvatar');
        this.applyTheme(this.currentUser.theme);
    }

    updateAvatarElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            if (this.currentUser.avatarImage) {
                element.innerHTML = `<img src="${this.currentUser.avatarImage}" alt="Аватар" class="avatar-image ${elementId === 'footerUserAvatar' ? 'small' : ''}">`;
                element.classList.add('has-image');
                element.style.background = 'transparent';
            } else {
                element.textContent = this.currentUser.avatar;
                element.style.background = this.currentUser.avatarColor;
                element.classList.remove('has-image');
                
                const img = element.querySelector('img');
                if (img) {
                    img.remove();
                }
            }
        }
    }

    applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.style.setProperty('--white', '#1a1a1a');
            document.documentElement.style.setProperty('--text-dark', '#ffffff');
            document.documentElement.style.setProperty('--orange-light', '#2a1f15');
            document.documentElement.style.setProperty('--gray', '#404040');
            document.documentElement.style.setProperty('--gray-medium', '#8a8a8a');
        } else {
            document.documentElement.style.setProperty('--white', '#FFFFFF');
            document.documentElement.style.setProperty('--text-dark', '#1A1A1A');
            document.documentElement.style.setProperty('--orange-light', '#fdf1e7');
            document.documentElement.style.setProperty('--gray', '#E9ECEF');
            document.documentElement.style.setProperty('--gray-medium', '#ADB5BD');
        }
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    async sendMessage() {
        if (!this.currentChat) {
            this.showMessage('Выберите беседу для отправки сообщения', 'error');
            return;
        }

        const messageInput = document.querySelector('.message-input');
        if (!messageInput) return;

        const text = messageInput.value.trim();
        if (!text) {
            this.showMessage('Введите сообщение', 'error');
            return;
        }

        const sendBtn = document.querySelector('.send-btn');
        this.toggleSendButtonState(sendBtn, true);

        try {
            // Если нет подключения к Ably, создаем его
            if (!this.channel) {
                this.setupChatRealtime(this.currentChat.id);
                // Ждем подключения
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            const message = {
                id: Date.now().toString(),
                text: text,
                sender: this.currentUser.fullName,
                senderId: this.currentUser.id,
                timestamp: new Date().toISOString(),
                chatId: this.currentChat.id
            };

            // Публикуем сообщение через Ably
            await this.channel.publish('message', {
                message: message,
                sender: this.currentUser.fullName,
                chatId: this.currentChat.id
            });

            // Локально добавляем сообщение
            if (!this.messages.has(this.currentChat.id)) {
                this.messages.set(this.currentChat.id, []);
            }
            
            // Проверяем, нет ли уже такого сообщения
            const existingMessage = this.messages.get(this.currentChat.id).find(m => m.id === message.id);
            if (!existingMessage) {
                this.messages.get(this.currentChat.id).push(message);
            }
            
            messageInput.value = '';
            this.autoResizeTextarea(messageInput);
            this.renderMessages();
            this.scrollToBottom();
            
            this.showMessage('Сообщение отправлено', 'success');
            
        } catch (error) {
            console.error('❌ Error sending message:', error);
            this.showMessage('Ошибка отправки сообщения', 'error');
        } finally {
            this.toggleSendButtonState(sendBtn, false);
        }
    }

    toggleSendButtonState(button, isLoading) {
        if (!button) return;
        
        const icon = button.querySelector('i');
        if (isLoading) {
            button.disabled = true;
            icon.className = 'fas fa-spinner fa-spin';
        } else {
            button.disabled = false;
            icon.className = 'fas fa-paper-plane';
        }
    }

    renderMessages() {
        if (!this.currentChat) return;

        const messagesContainer = document.querySelector('.messages-container');
        if (!messagesContainer) return;
        
        const messages = this.messages.get(this.currentChat.id) || [];
        
        if (messages.length === 0) {
            messagesContainer.innerHTML = `
                <div class="empty-chat">
                    <div class="empty-chat-icon">
                        <i class="fas fa-comments"></i>
                    </div>
                    <h3>Нет сообщений</h3>
                    <p>Начните общение - отправьте первое сообщение</p>
                </div>
            `;
        } else {
            // Группируем сообщения по датам
            const groupedMessages = {};
            messages.forEach(message => {
                const date = new Date(message.timestamp).toDateString();
                if (!groupedMessages[date]) {
                    groupedMessages[date] = [];
                }
                groupedMessages[date].push(message);
            });

            let html = '';
            Object.keys(groupedMessages).forEach(date => {
                const dateMessages = groupedMessages[date];
                html += `
                    <div class="date-divider">
                        <span>${this.formatDate(new Date(date))}</span>
                    </div>
                `;
                
                html += dateMessages.map(message => `
                    <div class="message ${message.senderId === this.currentUser.id ? 'sent' : 'received'}">
                        <div class="message-content">
                            <div class="message-bubble">
                                <div class="message-text">${this.escapeHtml(message.text)}</div>
                                <div class="message-time">
                                    ${this.formatTime(message.timestamp)}
                                    ${message.senderId === this.currentUser.id ? `
                                        <div class="message-status">
                                            <i class="fas fa-check-double seen"></i>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('');
            });

            messagesContainer.innerHTML = html;
            this.scrollToBottom();
        }
    }

    scrollToBottom() {
        const messagesContainer = document.querySelector('.messages-container');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    openChat(chatId) {
        console.log('💬 Opening chat:', chatId);
        this.currentChat = this.chats.find(chat => chat.id === chatId);
        
        if (this.currentChat) {
            // ПОДКЛЮЧАЕМСЯ К ABLY ДЛЯ ЭТОГО ЧАТА
            if (this.ably) {
                this.setupChatRealtime(chatId);
            }
            
            const welcomeScreen = document.querySelector('.welcome-screen');
            const activeChat = document.querySelector('.active-chat');
            const mobileHeader = document.querySelector('.mobile-chat-header');
            
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            if (activeChat) activeChat.style.display = 'flex';
            
            // На мобильных показываем мобильный хедер
            if (window.innerWidth <= 768 && mobileHeader) {
                mobileHeader.style.display = 'flex';
                document.getElementById('mobilePartnerName').textContent = this.currentChat.name;
                document.getElementById('mobileChatAvatar').textContent = this.currentChat.name.charAt(0);
            } else {
                // На ПК показываем обычный хедер
                const partnerName = document.querySelector('.partner-name');
                if (partnerName) {
                    partnerName.textContent = this.currentChat.name;
                }
            }
            
            this.currentChat.unread = 0;
            
            // Загружаем историю сообщений
            this.renderMessages();
            this.renderChatsList();
            
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) {
                    sidebar.classList.remove('active');
                }
            }
            
            console.log('✅ Chat opened successfully with Ably');
        } else {
            console.error('❌ Chat not found:', chatId);
            this.showMessage('Чат не найден', 'error');
        }
    }

    renderChatsList(chatsToRender = null) {
        const chatsList = document.querySelector('.chats-list');
        const emptyState = document.querySelector('#chatsTab .empty-state');

        if (!chatsList || !emptyState) return;

        const chats = chatsToRender || this.chats;

        if (chats.length === 0) {
            chatsList.style.display = 'none';
            emptyState.style.display = 'flex';
        } else {
            chatsList.style.display = 'block';
            emptyState.style.display = 'none';
            
            chatsList.innerHTML = chats.map(chat => {
                const messages = this.messages.get(chat.id) || [];
                const lastMessage = messages.slice(-1)[0];
                const unreadCount = chat.id === this.currentChat?.id ? 0 : (chat.unread || 0);
                
                return `
                <div class="chat-item ${this.currentChat?.id === chat.id ? 'active' : ''}" 
                     onclick="messenger.openChat('${chat.id}')">
                    <div class="chat-avatar">
                        <div class="avatar-placeholder">${chat.name.charAt(0)}</div>
                        <div class="online-status"></div>
                    </div>
                    <div class="chat-content">
                        <div class="chat-header">
                            <div class="chat-name">${this.escapeHtml(chat.name)}</div>
                            <div class="chat-time">${this.formatTime(chat.lastActivity)}</div>
                        </div>
                        <div class="chat-preview">
                            <div class="last-message">
                                ${lastMessage ? 
                                    this.escapeHtml(this.truncateText(lastMessage.text, 30)) : 
                                    'Нет сообщений'}
                            </div>
                            ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
                        </div>
                    </div>
                </div>
            `}).join('');
        }
    }

    renderFriendsList(friendsToRender = null) {
        const friendsList = document.querySelector('.friends-list');
        const emptyState = document.querySelector('#friendsTab .empty-state');
        const friendsBadge = document.getElementById('friendsBadge');

        if (!friendsList || !emptyState) return;

        const friends = friendsToRender || this.friends;

        if (friendsBadge) {
            friendsBadge.textContent = friends.length;
        }

        if (friends.length === 0) {
            friendsList.style.display = 'none';
            emptyState.style.display = 'flex';
        } else {
            friendsList.style.display = 'block';
            emptyState.style.display = 'none';
            
            friendsList.innerHTML = friends.map(friend => `
                <div class="friend-item">
                    <div class="friend-avatar">
                        <div class="avatar-placeholder small" style="background: ${friend.avatarColor}">${friend.avatar}</div>
                        <div class="online-status ${friend.status === 'online' ? '' : 'away'}"></div>
                    </div>
                    <div class="friend-content">
                        <div class="friend-header">
                            <div class="friend-name">${this.escapeHtml(friend.name)}</div>
                            <div class="friend-status ${friend.status === 'online' ? 'status-online' : 'status-offline'}">
                                ${friend.status === 'online' ? 'online' : 'offline'}
                            </div>
                        </div>
                    </div>
                    <div class="friend-actions">
                        <button class="friend-action-btn chat" onclick="messenger.startChatWithFriend('${friend.id}')" title="Написать сообщение">
                            <i class="fas fa-comment"></i>
                        </button>
                        <button class="friend-action-btn remove" onclick="messenger.removeFriend('${friend.id}')" title="Удалить друга">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }

    startChatWithFriend(friendId) {
        console.log('💬 Starting chat with friend:', friendId);
        const friend = this.friends.find(f => f.id === friendId);
        if (!friend) {
            console.error('❌ Friend not found:', friendId);
            this.showMessage('Друг не найден', 'error');
            return;
        }

        let chat = this.chats.find(c => c.isFriendChat && c.friendId === friendId);
        
        if (!chat) {
            console.log('🆕 Creating new chat with friend:', friend.name);
            chat = {
                id: 'chat_' + Date.now(),
                name: friend.name,
                messages: [],
                unread: 0,
                lastActivity: new Date(),
                created: new Date(),
                isFriendChat: true,
                friendId: friend.id
            };

            this.chats.unshift(chat);
            
            if (!this.messages.has(chat.id)) {
                this.messages.set(chat.id, []);
            }
            
            this.saveToStorage();
            this.renderChatsList();
        }

        this.openChat(chat.id);
        this.switchTab('chats');
        
        this.showMessage(`Чат с ${friend.name} открыт`, 'success');
        console.log('✅ Chat with friend opened successfully');
    }

    removeFriend(friendId) {
        console.log('🗑️ Removing friend:', friendId);
        const friend = this.friends.find(f => f.id === friendId);
        if (friend) {
            // Подтверждение удаления
            if (!confirm(`Вы уверены, что хотите удалить ${friend.name} из друзей?`)) {
                return;
            }

            this.usedNames.delete(friend.name);
            this.friends = this.friends.filter(f => f.id !== friendId);
            
            // Удаляем чат с этим другом
            this.chats = this.chats.filter(chat => !(chat.isFriendChat && chat.friendId === friendId));
            
            this.saveToStorage();
            this.renderFriendsList();
            this.renderChatsList();
            
            this.showMessage(`Друг "${friend.name}" удален`, 'success');
            console.log('✅ Friend removed successfully:', friend.name);
        } else {
            console.error('❌ Friend not found for removal:', friendId);
            this.showMessage('Друг не найден', 'error');
        }
    }

    formatTime(date) {
        return new Date(date).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatDate(date) {
        const today = new Date();
        const messageDate = new Date(date);
        
        if (messageDate.toDateString() === today.toDateString()) {
            return 'Сегодня';
        }
        
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (messageDate.toDateString() === yesterday.toDateString()) {
            return 'Вчера';
        }
        
        return messageDate.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long'
        });
    }

    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    saveToStorage() {
        try {
            const data = {
                chats: this.chats,
                friends: this.friends,
                user: this.currentUser,
                usedNames: Array.from(this.usedNames),
                messages: Array.from(this.messages.entries())
            };
            localStorage.setItem('rurum-data', JSON.stringify(data));
            console.log('💾 Data saved to storage');
        } catch (error) {
            console.error('❌ Error saving data:', error);
        }
    }

    loadFromStorage() {
        console.log('📂 Loading data from storage...');
        const saved = localStorage.getItem('rurum-data');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.chats = data.chats || [];
                this.friends = data.friends || [];
                this.currentUser = { ...this.currentUser, ...data.user };
                this.usedNames = new Set(data.usedNames || ['Пользователь']);
                
                this.messages = new Map(data.messages || []);
                
                console.log('✅ Data loaded from storage');
            } catch (e) {
                console.error('❌ Error loading data:', e);
                this.chats = [];
                this.friends = [];
                this.usedNames = new Set(['Пользователь']);
                this.messages = new Map();
            }
        } else {
            console.log('📝 No data found in storage');
            this.chats = [];
            this.friends = [];
            this.usedNames = new Set(['Пользователь']);
            this.messages = new Map();
        }
    }

    showMessage(message, type = 'success') {
        console.log(`💬 ${type.toUpperCase()}: ${message}`);
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check' : 'exclamation'}-circle"></i>
                <span>${message}</span>
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

// Инициализация приложения
console.log('🚀 Starting Rurum Messenger with Ably...');
const messenger = new RurumMessenger();
window.messenger = messenger;

document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM fully loaded');
    messenger.init();
    
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';
    
    setTimeout(() => {
        document.body.style.opacity = '1';
        console.log('🎉 App fully loaded and visible');
    }, 100);
});

window.debugData = () => {
    console.log('🐛 DEBUG DATA:');
    console.log('Chats:', messenger.chats);
    console.log('Friends:', messenger.friends);
    console.log('Current Chat:', messenger.currentChat);
    console.log('User:', messenger.currentUser);
    console.log('Used Names:', Array.from(messenger.usedNames));
    console.log('Messages:', Array.from(messenger.messages.entries()));
    console.log('Ably connected:', messenger.ably ? messenger.ably.connection.state : 'No');
};

window.clearData = () => {
    if (confirm('Очистить все данные?')) {
        localStorage.clear();
        location.reload();
    }
};

window.testAbly = () => {
    if (messenger.ably) {
        console.log('🔧 Ably connection state:', messenger.ably.connection.state);
        console.log('🔧 Ably channel:', messenger.channel ? messenger.channel.name : 'No channel');
    } else {
        console.log('❌ Ably not initialized');
    }
};