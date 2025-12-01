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
        
        // Ably настройки
        this.ably = null;
        this.channel = null;
        this.ABLY_API_KEY = 'AcL67w.nyZ_5A:J4JyAk0k9idP-77-GRCp6No-lbfpF2UG0peFaC-9qSg';
        
        // Временное хранилище сообщений
        this.messages = new Map();
        
        // Система заявок в друзья
        this.friendRequests = [];
        this.sentRequests = [];
        
        // Для удаления чата
        this.chatToDelete = null;
        
        // Для межвкладочной коммуникации
        this.broadcastChannel = null;
        
        // Таймер для периодической проверки заявок
        this.requestsCheckInterval = null;
        
        // Для хранения ID чатов для Ably
        this.ablyChannels = new Map();
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
        
        // Инициализируем межвкладочную коммуникацию
        this.setupCrossTabCommunication();
        
        // Инициализируем Ably
        this.initAbly();
        
        // Начинаем периодическую проверку заявок
        this.startRequestsCheckInterval();
        
        // Проверяем сохраненные заявки сразу
        setTimeout(() => {
            this.checkPendingFriendRequests();
            this.checkFriendResponses();
        }, 1000);
        
        // Запрашиваем разрешение на уведомления
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
        
        this.isInitialized = true;
        console.log('✅ Messenger initialized');
        
        // Проверяем есть ли открытый чат при загрузке
        if (this.currentChat) {
            this.openChat(this.currentChat.id);
        }
    }

    setupCrossTabCommunication() {
        try {
            // Используем BroadcastChannel для общения между вкладками
            if ('BroadcastChannel' in window) {
                this.broadcastChannel = new BroadcastChannel('rurum_messenger');
                
                this.broadcastChannel.onmessage = (event) => {
                    console.log('📨 Broadcast message:', event.data);
                    this.handleBroadcastMessage(event.data);
                };
                
                console.log('📡 BroadcastChannel initialized');
            }
            
            // Также слушаем события localStorage
            window.addEventListener('storage', (event) => {
                console.log('💾 Storage event:', event.key);
                if (event.key === 'rurum_friend_requests' || event.key === 'rurum_friend_responses') {
                    this.checkPendingFriendRequests();
                    this.checkFriendResponses();
                }
            });
            
        } catch (error) {
            console.error('❌ Error setting up cross-tab communication:', error);
        }
    }

    handleBroadcastMessage(data) {
        if (!data || !data.type) return;
        
        console.log('📨 Processing broadcast:', data.type);
        
        switch (data.type) {
            case 'friend_request':
                this.processFriendRequest(data.request);
                break;
            case 'friend_response':
                this.processFriendResponse(data.response);
                break;
            case 'new_message':
                this.handleBroadcastMessage(data.messageData);
                break;
        }
    }

    // УПРОЩЕННАЯ СИСТЕМА ЗАЯВОК В ДРУЗЬЯ
    sendFriendRequest() {
        console.log('📤 Sending friend request...');
        const friendNameInput = document.getElementById('friendNameInput');
        if (!friendNameInput) return;

        const friendName = friendNameInput.value.trim();
        
        this.clearValidationMessages();
        
        if (!friendName) {
            this.showValidationMessage('Введите имя пользователя', 'error');
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

        if (friendName === this.currentUser.fullName) {
            this.showValidationMessage('Нельзя отправить заявку самому себе', 'error');
            return;
        }

        // Проверяем, не отправили ли уже заявку этому пользователю
        const existingSentRequest = this.sentRequests.find(req => 
            req.toUserName === friendName
        );
        if (existingSentRequest) {
            this.showValidationMessage('Вы уже отправили заявку этому пользователю', 'error');
            return;
        }

        // Проверяем, не является ли уже другом
        const existingFriend = this.friends.find(friend => friend.name === friendName);
        if (existingFriend) {
            this.showValidationMessage('Этот пользователь уже у вас в друзьях', 'error');
            return;
        }

        // Проверяем, не отправил ли нам уже заявку этот пользователь
        const existingIncomingRequest = this.friendRequests.find(req => 
            req.fromUserName === friendName
        );
        if (existingIncomingRequest) {
            this.showValidationMessage('Этот пользователь уже отправил вам заявку. Проверьте входящие заявки.', 'error');
            return;
        }

        // Создаем ID заявки
        const requestId = 'request_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Создаем заявку
        const friendRequest = {
            id: requestId,
            fromUserId: this.currentUser.id,
            fromUserName: this.currentUser.fullName,
            toUserName: friendName,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        
        // Добавляем в отправленные заявки
        this.sentRequests.push({
            id: requestId,
            toUserName: friendName,
            fromUserName: this.currentUser.fullName,
            fromUserId: this.currentUser.id,
            timestamp: new Date().toISOString(),
            status: 'pending'
        });
        
        // Сохраняем заявку в глобальное хранилище
        this.saveFriendRequestToStorage(friendRequest);
        
        // Отправляем заявку через BroadcastChannel
        this.broadcastFriendRequest(friendRequest);
        
        this.hideAddFriendModal();
        
        this.showMessage(`Заявка отправлена пользователю ${friendName}. Откройте приложение на другом устройстве под именем "${friendName}" чтобы получить заявку.`, 'success');
        console.log('✅ Friend request sent:', friendName);
        
        this.saveToStorage();
    }

    // ПРОСТОЙ МЕТОД СОХРАНЕНИЯ ЗАЯВОК
    saveFriendRequestToStorage(request) {
        try {
            // Получаем текущие заявки
            let allRequests = JSON.parse(localStorage.getItem('rurum_friend_requests') || '[]');
            
            // Добавляем новую заявку
            allRequests.push({
                ...request,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 часа
            });
            
            // Сохраняем обратно
            localStorage.setItem('rurum_friend_requests', JSON.stringify(allRequests));
            
            console.log('💾 Friend request saved to storage');
            
        } catch (error) {
            console.error('❌ Error saving friend request:', error);
        }
    }

    // ПРОСТОЙ МЕТОД ПРОВЕРКИ ЗАЯВОК
    checkPendingFriendRequests() {
        try {
            console.log('🔍 Checking for pending friend requests...');
            
            // Получаем все заявки из хранилища
            const allRequests = JSON.parse(localStorage.getItem('rurum_friend_requests') || '[]');
            
            // Фильтруем старые заявки
            const currentTime = new Date();
            const validRequests = allRequests.filter(request => {
                const expiresAt = new Date(request.expiresAt);
                return expiresAt > currentTime;
            });
            
            // Обновляем хранилище (удаляем просроченные)
            localStorage.setItem('rurum_friend_requests', JSON.stringify(validRequests));
            
            // Ищем заявки, адресованные текущему пользователю
            const myName = this.currentUser.fullName;
            const myRequests = validRequests.filter(request => 
                request.toUserName === myName && 
                request.fromUserId !== this.currentUser.id
            );
            
            console.log('📨 Found requests for me:', myRequests.length);
            
            // Обрабатываем каждую заявку
            myRequests.forEach(request => {
                this.processFriendRequest(request);
            });
            
        } catch (error) {
            console.error('❌ Error checking friend requests:', error);
        }
    }

    // ОБРАБОТКА ПОЛУЧЕННОЙ ЗАЯВКИ
    processFriendRequest(request) {
        // Проверяем, адресована ли заявка текущему пользователю
        if (request.toUserName !== this.currentUser.fullName) {
            console.log('📭 Friend request not for current user:', request.toUserName);
            return;
        }
        
        // Проверяем, нет ли уже такой заявки
        const existingRequest = this.friendRequests.find(req => req.id === request.id);
        if (existingRequest) {
            console.log('📭 Duplicate friend request, ignoring');
            return;
        }
        
        // Проверяем, не отправили ли мы сами эту заявку
        if (request.fromUserId === this.currentUser.id) {
            console.log('📭 Our own friend request, ignoring');
            return;
        }
        
        console.log('📨 Processing friend request from:', request.fromUserName);
        
        // Добавляем заявку
        const newRequest = {
            id: request.id,
            fromUserId: request.fromUserId,
            fromUserName: request.fromUserName,
            timestamp: request.timestamp,
            status: 'pending'
        };
        
        this.friendRequests.push(newRequest);
        this.updateRequestsBadge();
        this.saveToStorage();
        
        // Показываем уведомление
        this.showNotification('Новая заявка в друзья', 
            `${newRequest.fromUserName} хочет добавить вас в друзья`);
        
        // Обновляем интерфейс
        this.renderFriendRequests();
        
        // Показываем сообщение
        this.showMessage(`Новая заявка в друзья от ${newRequest.fromUserName}`, 'info');
    }

    broadcastFriendRequest(request) {
        try {
            const broadcastData = {
                type: 'friend_request',
                request: request,
                timestamp: Date.now(),
                source: this.currentUser.id
            };
            
            // Отправляем через BroadcastChannel
            if (this.broadcastChannel) {
                this.broadcastChannel.postMessage(broadcastData);
            }
            
            console.log('📤 Friend request broadcasted');
            
        } catch (error) {
            console.error('❌ Error broadcasting friend request:', error);
        }
    }

    acceptFriendRequest(requestId) {
        console.log('✅ Accepting friend request:', requestId);
        
        const request = this.friendRequests.find(req => req.id === requestId);
        if (!request) {
            console.error('❌ Request not found:', requestId);
            return;
        }

        // Добавляем в друзья
        const newFriend = {
            id: request.fromUserId,
            name: request.fromUserName,
            avatar: request.fromUserName.charAt(0).toUpperCase(),
            avatarColor: this.getRandomColor(),
            status: 'online',
            lastSeen: new Date(),
            addedAt: new Date()
        };

        this.friends.unshift(newFriend);
        this.usedNames.add(request.fromUserName);
        
        // Удаляем заявку
        this.friendRequests = this.friendRequests.filter(req => req.id !== requestId);
        
        // Сохраняем
        this.saveToStorage();
        this.updateRequestsBadge();
        this.renderFriendsList();
        this.renderFriendRequests();
        
        // Отправляем ответ
        this.sendFriendResponse(requestId, true, request.fromUserId, request.fromUserName);
        
        this.showMessage(`Вы приняли заявку от ${request.fromUserName}`, 'success');
        
        // Автоматически создаем чат с новым другом
        this.createFriendChat(request.fromUserId, request.fromUserName);
        
        // Закрываем модальное окно если открыто
        if (this.friendRequests.length === 0) {
            this.hideAllModals();
        }
    }

    rejectFriendRequest(requestId) {
        console.log('❌ Rejecting friend request:', requestId);
        
        const request = this.friendRequests.find(req => req.id === requestId);
        if (!request) {
            console.error('❌ Request not found:', requestId);
            return;
        }

        // Удаляем заявку
        this.friendRequests = this.friendRequests.filter(req => req.id !== requestId);
        
        // Сохраняем
        this.saveToStorage();
        this.updateRequestsBadge();
        this.renderFriendRequests();
        
        // Отправляем ответ
        this.sendFriendResponse(requestId, false, request.fromUserId, request.fromUserName);
        
        this.showMessage(`Вы отклонили заявку от ${request.fromUserName}`, 'info');
        
        // Закрываем модальное окно если открыто
        if (this.friendRequests.length === 0) {
            this.hideAllModals();
        }
    }

    sendFriendResponse(requestId, accepted, toUserId, toUserName) {
        try {
            const response = {
                id: requestId,
                accepted: accepted,
                fromUserId: this.currentUser.id,
                fromUserName: this.currentUser.fullName,
                toUserId: toUserId,
                toUserName: toUserName,
                timestamp: new Date().toISOString()
            };
            
            // Сохраняем ответ в хранилище
            this.saveFriendResponseToStorage(response);
            
            // Отправляем через BroadcastChannel
            if (this.broadcastChannel) {
                this.broadcastChannel.postMessage({
                    type: 'friend_response',
                    response: response,
                    timestamp: Date.now()
                });
            }
            
            console.log('📤 Friend response sent:', response);
            
        } catch (error) {
            console.error('❌ Error sending friend response:', error);
        }
    }

    saveFriendResponseToStorage(response) {
        try {
            let allResponses = JSON.parse(localStorage.getItem('rurum_friend_responses') || '[]');
            allResponses.push({
                ...response,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            });
            localStorage.setItem('rurum_friend_responses', JSON.stringify(allResponses));
            
        } catch (error) {
            console.error('❌ Error saving friend response:', error);
        }
    }

    // ПРОВЕРКА ОТВЕТОВ НА ЗАЯВКИ
    checkFriendResponses() {
        try {
            const allResponses = JSON.parse(localStorage.getItem('rurum_friend_responses') || '[]');
            const currentTime = new Date();
            
            // Ищем ответы, адресованные нам
            const myResponses = allResponses.filter(response => 
                response.toUserId === this.currentUser.id &&
                new Date(response.expiresAt) > currentTime
            );
            
            console.log('🔍 Checking friend responses:', myResponses.length);
            
            myResponses.forEach(response => {
                this.processFriendResponse(response);
            });
            
            // Удаляем обработанные ответы
            const remainingResponses = allResponses.filter(response => 
                !myResponses.some(r => r.id === response.id)
            );
            localStorage.setItem('rurum_friend_responses', JSON.stringify(remainingResponses));
            
        } catch (error) {
            console.error('❌ Error checking friend responses:', error);
        }
    }

    processFriendResponse(response) {
        console.log('📨 Processing friend response:', response);
        
        const sentRequestIndex = this.sentRequests.findIndex(req => req.id === response.id);
        
        if (sentRequestIndex !== -1) {
            const request = this.sentRequests[sentRequestIndex];
            
            if (response.accepted) {
                // Добавляем в друзья
                const newFriend = {
                    id: response.fromUserId,
                    name: response.fromUserName,
                    avatar: response.fromUserName.charAt(0).toUpperCase(),
                    avatarColor: this.getRandomColor(),
                    status: 'online',
                    lastSeen: new Date(),
                    addedAt: new Date()
                };
                
                this.friends.unshift(newFriend);
                this.usedNames.add(response.fromUserName);
                
                // Удаляем заявку из отправленных
                this.sentRequests.splice(sentRequestIndex, 1);
                
                this.showMessage(`${response.fromUserName} принял(а) вашу заявку в друзья!`, 'success');
                
                // Автоматически создаем чат с новым другом
                this.createFriendChat(response.fromUserId, response.fromUserName);
            } else {
                // Заявка отклонена
                this.sentRequests.splice(sentRequestIndex, 1);
                this.showMessage(`${response.fromUserName} отклонил(а) вашу заявку в друзья`, 'warning');
            }
            
            this.saveToStorage();
            this.renderFriendsList();
            this.renderChatsList();
        }
    }

    startRequestsCheckInterval() {
        // Проверяем заявки и ответы каждые 3 секунды
        this.requestsCheckInterval = setInterval(() => {
            this.checkPendingFriendRequests();
            this.checkFriendResponses();
        }, 3000);
    }

    stopRequestsCheckInterval() {
        if (this.requestsCheckInterval) {
            clearInterval(this.requestsCheckInterval);
            this.requestsCheckInterval = null;
        }
    }

    initAbly() {
        try {
            if (!this.ABLY_API_KEY || this.ABLY_API_KEY.length < 10) {
                console.warn('⚠️ Ably API key not provided or too short');
                this.showMessage('Режим без сервера: сообщения работают только в этой вкладке', 'warning');
                return;
            }
            
            console.log('🔌 Initializing Ably...');
            
            // Проверяем, загружена ли библиотека Ably
            if (typeof Ably === 'undefined') {
                console.error('❌ Ably library not loaded');
                this.showMessage('Библиотека Ably не загружена. Проверьте подключение скрипта.', 'error');
                return;
            }
            
            this.ably = new Ably.Realtime({
                key: this.ABLY_API_KEY,
                echoMessages: false,
                autoConnect: true
            });
            
            this.ably.connection.on('connected', () => {
                console.log('✅ Connected to Ably');
                this.showMessage('Подключено к серверу сообщений', 'success');
                this.setupChatChannels();
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
            
            // Пытаемся подключиться
            this.ably.connect();
            
        } catch (error) {
            console.error('❌ Error initializing Ably:', error);
            this.showMessage('Ошибка инициализации Ably. Проверьте API ключ.', 'error');
        }
    }

    setupChatChannels() {
        if (!this.ably) return;
        
        console.log('🎧 Setting up chat channels...');
        this.chats.forEach(chat => {
            if (!chat.hidden) {
                this.subscribeToChat(chat.id);
            }
        });
    }

    subscribeToChat(chatId) {
        if (!this.ably || this.ablyChannels.has(chatId)) return;
        
        try {
            const chatChannel = this.ably.channels.get(`chat:${chatId}`);
            
            chatChannel.subscribe('message', (message) => {
                console.log('📨 Message received from Ably:', message.data);
                this.handleIncomingMessage(message.data, chatId);
            });
            
            chatChannel.subscribe('presence', (presenceMsg) => {
                console.log('👤 Presence update:', presenceMsg);
            });
            
            this.ablyChannels.set(chatId, chatChannel);
            
            console.log(`🎧 Subscribed to chat: ${chatId}`);
            
        } catch (error) {
            console.error(`❌ Error subscribing to chat ${chatId}:`, error);
        }
    }

    unsubscribeFromChat(chatId) {
        if (this.ablyChannels.has(chatId)) {
            try {
                const channel = this.ablyChannels.get(chatId);
                channel.unsubscribe();
                this.ablyChannels.delete(chatId);
                console.log(`🎧 Unsubscribed from chat: ${chatId}`);
            } catch (error) {
                console.error(`❌ Error unsubscribing from chat ${chatId}:`, error);
            }
        }
    }

    handleIncomingMessage(messageData, chatId) {
        try {
            const { message, sender } = messageData;
            
            if (!message) {
                console.warn('⚠️ Empty message received');
                return;
            }
            
            console.log(`📨 Processing message for chat ${chatId}:`, message);
            
            // Инициализируем хранилище сообщений для чата если нужно
            if (!this.messages.has(chatId)) {
                this.messages.set(chatId, []);
            }
            
            // Проверяем, нет ли уже такого сообщения
            const existingMessage = this.messages.get(chatId).find(m => m.id === message.id);
            if (existingMessage) {
                console.log('📭 Duplicate message, ignoring');
                return;
            }
            
            // Добавляем сообщение
            this.messages.get(chatId).push(message);
            
            // Обновляем время последней активности чата
            const chat = this.chats.find(c => c.id === chatId);
            if (chat) {
                chat.lastActivity = new Date();
                chat.lastMessage = message.text;
                
                // Если чат не текущий, увеличиваем счетчик непрочитанных
                if (!this.currentChat || this.currentChat.id !== chatId) {
                    chat.unread = (chat.unread || 0) + 1;
                    this.showNotification(`Новое сообщение от ${sender}`, message.text);
                }
            }
            
            // Если это текущий открытый чат, обновляем интерфейс
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages();
                this.scrollToBottom();
            }
            
            // Обновляем список чатов
            this.renderChatsList();
            
            // Сохраняем данные
            this.saveToStorage();
            
        } catch (error) {
            console.error('❌ Error handling incoming message:', error);
        }
    }

    setupChatRealtime(chatId) {
        if (!this.ably) {
            console.warn('⚠️ Ably not initialized, using local mode');
            return;
        }
        
        console.log(`🔌 Setting up realtime for chat: ${chatId}`);
        
        // Отписываемся от предыдущего канала если нужно
        if (this.channel) {
            this.channel.unsubscribe();
        }
        
        // Подписываемся на новый канал
        this.channel = this.ably.channels.get(`chat:${chatId}`);
        
        this.channel.subscribe('message', (message) => {
            this.handleIncomingMessage(message.data, chatId);
        });
        
        // Также добавляем в общую подписку
        if (!this.ablyChannels.has(chatId)) {
            this.ablyChannels.set(chatId, this.channel);
        }
        
        // Загружаем историю
        this.loadChannelHistory(chatId);
        
        console.log(`🎧 Connected to Ably channel: chat:${chatId}`);
    }

    async loadChannelHistory(chatId) {
        if (!this.channel) return;
        
        try {
            console.log(`📚 Loading history for chat: ${chatId}`);
            
            const historyPage = await this.channel.history({ limit: 100 });
            const ablyMessages = historyPage.items
                .map(item => item.data.message)
                .filter(msg => msg && msg.id)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            console.log(`📚 Loaded ${ablyMessages.length} messages from Ably history`);
            
            const localMessages = this.messages.get(chatId) || [];
            const allMessages = [...localMessages, ...ablyMessages];
            
            // Убираем дубликаты
            const uniqueMessages = [];
            const seenIds = new Set();
            
            for (const msg of allMessages) {
                if (!seenIds.has(msg.id)) {
                    seenIds.add(msg.id);
                    uniqueMessages.push(msg);
                }
            }
            
            uniqueMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            this.messages.set(chatId, uniqueMessages);
            
            if (this.currentChat && this.currentChat.id === chatId) {
                this.renderMessages();
                this.scrollToBottom();
            }
            
        } catch (error) {
            console.error('❌ Error loading history from Ably:', error);
        }
    }

    bindEvents() {
        console.log('🔗 Binding messenger events...');
        
        // Навигация
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.closest('.nav-btn');
                if (target) {
                    this.switchTab(target.dataset.tab);
                }
            });
        });

        // Кнопки в шапке
        document.querySelector('.new-chat-btn')?.addEventListener('click', () => {
            this.showNewChatModal();
        });

        document.querySelector('.add-friend-btn')?.addEventListener('click', () => {
            this.showAddFriendModal();
        });

        // Кнопка заявок в друзья
        document.getElementById('requestsBtn')?.addEventListener('click', () => {
            this.showFriendRequestsModal();
        });

        document.getElementById('settingsBtn')?.addEventListener('click', () => {
            this.showSettings();
        });

        // Поиск
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });
            
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    searchInput.value = '';
                    this.handleSearch('');
                }
            });
        }

        // Кнопки в пустых состояниях
        document.querySelectorAll('.start-chat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.closest('.start-chat-btn');
                if (target) {
                    if (target.closest('#chatsTab') || target.closest('.welcome-screen')) {
                        this.showNewChatModal();
                    } else if (target.closest('#friendsTab')) {
                        this.showAddFriendModal();
                    }
                }
            });
        });

        // Модальные окна
        document.querySelector('.create-chat-btn')?.addEventListener('click', () => {
            this.createNewChat();
        });

        document.querySelector('.cancel-btn')?.addEventListener('click', () => {
            this.hideNewChatModal();
        });

        document.querySelector('.add-friend-confirm-btn')?.addEventListener('click', () => {
            this.sendFriendRequest();
        });

        document.querySelector('.cancel-add-friend-btn')?.addEventListener('click', () => {
            this.hideAddFriendModal();
        });

        document.querySelector('.save-settings-btn')?.addEventListener('click', () => {
            this.saveSettings();
        });

        document.querySelector('.cancel-settings-btn')?.addEventListener('click', () => {
            this.hideSettings();
        });

        // Кнопка закрытия чата
        document.querySelector('.close-chat-btn')?.addEventListener('click', () => {
            this.closeCurrentChat();
        });

        // Кнопка удаления чата
        document.querySelector('.delete-chat-btn')?.addEventListener('click', () => {
            this.showDeleteChatModal();
        });

        // Кнопки в модальном окне удаления
        document.querySelector('.delete-cancel-btn')?.addEventListener('click', () => {
            this.hideDeleteChatModal();
        });

        document.querySelector('.delete-confirm-btn')?.addEventListener('click', () => {
            this.deleteCurrentChat();
        });

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
        document.querySelector('.send-btn')?.addEventListener('click', () => {
            this.sendMessage();
        });

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
            
            // Фокус на поле ввода при открытии чата
            messageInput.addEventListener('focus', () => {
                this.scrollToBottom();
            });
        }

        // Мобильная навигация
        document.querySelector('.mobile-menu-toggle')?.addEventListener('click', () => {
            this.toggleSidebar();
        });

        document.querySelector('.mobile-back-btn')?.addEventListener('click', () => {
            this.hideChat();
        });

        // Аватар пользователя
        document.getElementById('userAvatarContainer')?.addEventListener('click', () => {
            this.showSettings();
        });

        // Загрузка аватара
        document.querySelector('.avatar-upload-btn')?.addEventListener('click', () => {
            document.getElementById('avatarUpload').click();
        });

        document.getElementById('avatarUpload')?.addEventListener('change', (e) => {
            this.handleAvatarUpload(e);
        });

        // Цвета аватара
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => {
                this.selectAvatarColor(e.target);
            });
        });

        // Тестовая кнопка
        document.getElementById('testBtn')?.addEventListener('click', () => {
            this.joinTestChat();
        });

        // Кнопки заявок в друзья (в модальном окне)
        document.getElementById('closeRequestsModal')?.addEventListener('click', () => {
            this.hideAllModals();
        });

        // Кнопка закрытия в модальном окне заявок
        const closeRequestsBtn = document.querySelector('#friendRequestsModal .close-modal');
        if (closeRequestsBtn) {
            closeRequestsBtn.addEventListener('click', () => {
                this.hideAllModals();
            });
        }
        
        // Обработка изменения размера окна
        window.addEventListener('resize', () => {
            this.handleResize();
        });
        
        // Обработка перед закрытием страницы
        window.addEventListener('beforeunload', () => {
            this.stopRequestsCheckInterval();
        });
    }

    handleResize() {
        if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
            }
        }
        
        // Перерисовываем чаты при изменении размера
        if (this.currentChat) {
            this.renderMessages();
        }
    }

    closeCurrentChat() {
        if (!this.currentChat) {
            this.showMessage('Нет активного чата для закрытия', 'warning');
            return;
        }
        
        this.hideChat();
        this.showMessage(`Чат "${this.currentChat.name}" закрыт`, 'info');
    }

    leaveChat(chatId, event = null) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        
        if (confirm(`Вы уверены, что хотите выйти из чата "${chat.name}"?`)) {
            if (this.currentChat && this.currentChat.id === chatId) {
                this.hideChat();
            }
            
            const chatItem = document.querySelector(`.chat-item[onclick*="${chatId}"]`);
            if (chatItem) {
                chatItem.classList.add('closing');
                
                setTimeout(() => {
                    this.chats = this.chats.filter(c => c.id !== chatId);
                    this.messages.delete(chatId);
                    this.unsubscribeFromChat(chatId);
                    this.saveToStorage();
                    this.renderChatsList();
                    this.showMessage(`Вы вышли из чата "${chat.name}"`, 'success');
                }, 400);
            } else {
                this.chats = this.chats.filter(c => c.id !== chatId);
                this.messages.delete(chatId);
                this.unsubscribeFromChat(chatId);
                this.saveToStorage();
                this.renderChatsList();
                this.showMessage(`Вы вышли из чата "${chat.name}"`, 'success');
            }
        }
    }

    showDeleteChatModal() {
        if (!this.currentChat) {
            this.showMessage('Выберите чат для удаления', 'warning');
            return;
        }
        
        const modal = document.getElementById('deleteChatModal');
        const chatNameElement = document.getElementById('deleteChatName');
        
        if (modal && chatNameElement) {
            this.chatToDelete = this.currentChat;
            chatNameElement.textContent = this.currentChat.name;
            modal.style.display = 'flex';
        }
    }

    hideDeleteChatModal() {
        const modal = document.getElementById('deleteChatModal');
        if (modal) {
            modal.style.display = 'none';
            this.chatToDelete = null;
        }
    }

    deleteCurrentChat() {
        if (!this.chatToDelete) return;
        
        const chatId = this.chatToDelete.id;
        const chatName = this.chatToDelete.name;
        
        const chatItem = document.querySelector(`.chat-item[onclick*="${chatId}"]`);
        if (chatItem) {
            chatItem.classList.add('deleting');
            
            setTimeout(() => {
                this.chats = this.chats.filter(chat => chat.id !== chatId);
                this.messages.delete(chatId);
                this.unsubscribeFromChat(chatId);
                
                if (this.currentChat && this.currentChat.id === chatId) {
                    this.currentChat = null;
                    this.hideChat();
                    
                    if (this.channel) {
                        this.channel.unsubscribe();
                        this.channel = null;
                    }
                }
                
                this.saveToStorage();
                this.renderChatsList();
                this.hideDeleteChatModal();
                this.showMessage(`Чат "${chatName}" удален`, 'success');
            }, 400);
        } else {
            this.chats = this.chats.filter(chat => chat.id !== chatId);
            this.messages.delete(chatId);
            this.unsubscribeFromChat(chatId);
            
            if (this.currentChat && this.currentChat.id === chatId) {
                this.currentChat = null;
                this.hideChat();
                
                if (this.channel) {
                    this.channel.unsubscribe();
                    this.channel = null;
                }
            }
            
            this.saveToStorage();
            this.renderChatsList();
            this.hideDeleteChatModal();
            this.showMessage(`Чат "${chatName}" удален`, 'success');
        }
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
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.remove('active');
        });
        document.getElementById(`${tabName}Tab`)?.classList.add('active');
        
        // Сбрасываем поиск при переключении вкладок
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.value = '';
            this.handleSearch('');
        }
        
        // Закрываем сайдбар на мобильных
        if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                sidebar.classList.remove('active');
            }
        }
    }

    showNewChatModal() {
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
        const chatNameInput = document.getElementById('chatNameInput');
        if (!chatNameInput) return;

        const chatName = chatNameInput.value.trim();
        
        if (!chatName) {
            this.showMessage('Введите название беседы', 'error');
            return;
        }

        if (chatName.length < 2) {
            this.showMessage('Название должно содержать минимум 2 символа', 'error');
            return;
        }

        if (chatName.length > 50) {
            this.showMessage('Название не должно превышать 50 символов', 'error');
            return;
        }

        const chatId = 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Проверяем, нет ли уже чата с таким именем
        let chat = this.chats.find(c => c.name.toLowerCase() === chatName.toLowerCase());
        
        if (!chat) {
            chat = {
                id: chatId,
                name: chatName,
                messages: [],
                unread: 0,
                lastActivity: new Date(),
                created: new Date(),
                isFriendChat: false,
                hidden: false
            };

            this.chats.unshift(chat);
            
            if (!this.messages.has(chat.id)) {
                this.messages.set(chat.id, []);
            }
            
            this.saveToStorage();
            this.renderChatsList();
            
            if (this.ably) {
                this.subscribeToChat(chatId);
            }
        }

        this.hideNewChatModal();
        this.openChat(chat.id);
        
        this.showMessage(`Беседа "${chatName}" создана`, 'success');
    }

    showAddFriendModal() {
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

    showFriendRequestsModal() {
        const modal = document.getElementById('friendRequestsModal');
        if (modal) {
            modal.style.display = 'flex';
            this.renderFriendRequests();
        }
    }

    hideFriendRequestsModal() {
        const modal = document.getElementById('friendRequestsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    getRandomColor() {
        const colors = [
            '#f6a75e', '#FF6B6B', '#4ECDC4', '#45B7D1', 
            '#96CEB4', '#FFEAA7', '#DDA0DD', '#FFA07A',
            '#778beb', '#e66767', '#786fa6', '#f19066',
            '#3dc1d3', '#63cdda', '#ea8685', '#596275'
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
        messageEl.style.marginTop = '5px';
        messageEl.style.fontSize = '12px';
        messageEl.style.padding = '4px 8px';
        messageEl.style.borderRadius = '4px';
        
        if (type === 'error') {
            messageEl.style.color = '#e74c3c';
            messageEl.style.backgroundColor = '#fdf2f2';
        } else {
            messageEl.style.color = '#27ae60';
            messageEl.style.backgroundColor = '#f2fdf6';
        }
        
        friendNameInput.parentNode.appendChild(messageEl);
    }

    clearValidationMessages() {
        const friendNameInput = document.getElementById('friendNameInput');
        if (!friendNameInput) return;

        const existingMessages = friendNameInput.parentNode.querySelectorAll('.input-error, .input-success');
        existingMessages.forEach(msg => msg.remove());
    }

    handleSearch(query) {
        const activeTab = document.querySelector('.tab-content.active')?.id;
        
        if (activeTab === 'chatsTab') {
            this.filterChats(query);
        } else if (activeTab === 'friendsTab') {
            this.filterFriends(query);
        }
    }

    filterChats(query) {
        const filteredChats = this.chats.filter(chat => 
            chat.name.toLowerCase().includes(query.toLowerCase()) && !chat.hidden
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

    updateRequestsBadge() {
        const badge = document.getElementById('requestsBadge');
        const requestsBtn = document.getElementById('requestsBtn');
        
        if (badge && requestsBtn) {
            if (this.friendRequests.length > 0) {
                badge.textContent = this.friendRequests.length > 99 ? '99+' : this.friendRequests.length;
                badge.style.display = 'flex';
                requestsBtn.classList.add('has-requests');
            } else {
                badge.style.display = 'none';
                requestsBtn.classList.remove('has-requests');
            }
        }
    }

    createFriendChat(friendId, friendName) {
        const chatId = 'friend_chat_' + friendId;
        
        let chat = this.chats.find(c => c.id === chatId);
        
        if (!chat) {
            chat = {
                id: chatId,
                name: friendName,
                messages: [],
                unread: 0,
                lastActivity: new Date(),
                created: new Date(),
                isFriendChat: true,
                friendId: friendId,
                hidden: false
            };

            this.chats.unshift(chat);
            
            if (!this.messages.has(chat.id)) {
                this.messages.set(chat.id, []);
            }
            
            this.saveToStorage();
            this.renderChatsList();
            
            if (this.ably) {
                this.subscribeToChat(chatId);
            }
            
            this.showMessage(`Чат с ${friendName} создан!`, 'success');
        }
        
        // Открываем чат
        this.openChat(chat.id);
    }

    renderFriendRequests() {
        const requestsList = document.getElementById('requestsList');
        const noRequestsMessage = document.getElementById('noRequestsMessage');
        const requestsCount = document.getElementById('requestsCount');
        
        if (!requestsList || !noRequestsMessage) return;

        if (requestsCount) {
            requestsCount.textContent = this.friendRequests.length;
        }

        if (this.friendRequests.length === 0) {
            requestsList.style.display = 'none';
            noRequestsMessage.style.display = 'block';
        } else {
            requestsList.style.display = 'block';
            noRequestsMessage.style.display = 'none';
            
            requestsList.innerHTML = this.friendRequests.map(request => {
                const timeAgo = this.getTimeAgo(request.timestamp);
                return `
                <div class="request-item">
                    <div class="request-info">
                        <div class="avatar-placeholder small" style="background: ${this.getRandomColor()}">
                            ${request.fromUserName.charAt(0).toUpperCase()}
                        </div>
                        <div class="request-details">
                            <div class="friend-name">${this.escapeHtml(request.fromUserName)}</div>
                            <div class="request-time">${timeAgo}</div>
                        </div>
                    </div>
                    <div class="request-actions">
                        <button class="request-btn accept-btn" onclick="messenger.acceptFriendRequest('${request.id}')" title="Принять">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="request-btn reject-btn" onclick="messenger.rejectFriendRequest('${request.id}')" title="Отклонить">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            `}).join('');
        }
    }

    getTimeAgo(timestamp) {
        const now = new Date();
        const past = new Date(timestamp);
        const diffMs = now - past;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        
        if (diffDay > 0) {
            return `${diffDay} дн. назад`;
        } else if (diffHour > 0) {
            return `${diffHour} ч. назад`;
        } else if (diffMin > 0) {
            return `${diffMin} мин. назад`;
        } else {
            return 'только что';
        }
    }

    showSettings() {
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
        this.chatToDelete = null;
    }

    saveSettings() {
        const userName = document.getElementById('userNameInput').value.trim();
        const userStatus = document.getElementById('userStatusInput').value.trim();
        const theme = document.querySelector('input[name="theme"]:checked')?.value;

        if (!userName) {
            this.showMessage('Введите имя пользователя', 'error');
            return;
        }

        if (userName.length < 2) {
            this.showMessage('Имя должно содержать минимум 2 символа', 'error');
            return;
        }

        if (userName.length > 20) {
            this.showMessage('Имя не должно превышать 20 символов', 'error');
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
        const userNameElements = document.querySelectorAll('#userName, #footerUserName');
        userNameElements.forEach(el => {
            if (el) {
                el.textContent = this.currentUser.fullName;
            }
        });

        this.updateAvatarElement('userAvatar');
        this.updateAvatarElement('footerUserAvatar');
        this.applyTheme(this.currentUser.theme);
        
        this.updateRequestsBadge();
        
        // Обновляем статус в интерфейсе
        const userStatusElement = document.querySelector('.user-status');
        if (userStatusElement) {
            userStatusElement.textContent = this.currentUser.status || 'online';
            userStatusElement.className = `user-status status-${this.currentUser.status === 'offline' ? 'offline' : 'online'}`;
        }
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
        const root = document.documentElement;
        if (theme === 'dark') {
            root.style.setProperty('--white', '#1a1a1a');
            root.style.setProperty('--text-dark', '#ffffff');
            root.style.setProperty('--orange-light', '#2a1f15');
            root.style.setProperty('--gray', '#404040');
            root.style.setProperty('--gray-medium', '#8a8a8a');
            root.style.setProperty('--gray-light', '#2a2a2a');
            root.style.setProperty('--shadow', '0 2px 10px rgba(0, 0, 0, 0.3)');
            document.body.classList.add('dark-theme');
        } else {
            root.style.setProperty('--white', '#FFFFFF');
            root.style.setProperty('--text-dark', '#1A1A1A');
            root.style.setProperty('--orange-light', '#fdf1e7');
            root.style.setProperty('--gray', '#E9ECEF');
            root.style.setProperty('--gray-medium', '#ADB5BD');
            root.style.setProperty('--gray-light', '#f8f9fa');
            root.style.setProperty('--shadow', '0 2px 10px rgba(0, 0, 0, 0.1)');
            document.body.classList.remove('dark-theme');
        }
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        const newHeight = Math.min(textarea.scrollHeight, 120);
        textarea.style.height = newHeight + 'px';
        
        // Прокручиваем контейнер сообщений вниз при увеличении текстового поля
        if (newHeight > 40) {
            this.scrollToBottom();
        }
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

        if (text.length > 1000) {
            this.showMessage('Сообщение слишком длинное (макс. 1000 символов)', 'error');
            return;
        }

        const sendBtn = document.querySelector('.send-btn');
        this.toggleSendButtonState(sendBtn, true);

        try {
            // Создаем сообщение
            const message = {
                id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                text: text,
                sender: this.currentUser.fullName,
                senderId: this.currentUser.id,
                timestamp: new Date().toISOString(),
                chatId: this.currentChat.id
            };

            // Если Ably подключен, отправляем через него
            if (this.ably && this.ably.connection.state === 'connected') {
                if (!this.channel) {
                    this.setupChatRealtime(this.currentChat.id);
                }
                
                await this.channel.publish('message', {
                    message: message,
                    sender: this.currentUser.fullName,
                    chatId: this.currentChat.id,
                    timestamp: Date.now()
                });
                
                console.log('📤 Message sent via Ably');
            } else {
                // Локальный режим - добавляем сообщение напрямую
                console.log('📤 Message sent locally (Ably not connected)');
                
                // Имитируем получение сообщения
                setTimeout(() => {
                    this.handleIncomingMessage({
                        message: message,
                        sender: this.currentUser.fullName,
                        chatId: this.currentChat.id
                    }, this.currentChat.id);
                }, 100);
            }

            // Добавляем сообщение в локальное хранилище
            if (!this.messages.has(this.currentChat.id)) {
                this.messages.set(this.currentChat.id, []);
            }
            
            this.messages.get(this.currentChat.id).push(message);
            
            // Обновляем время последней активности чата
            this.currentChat.lastActivity = new Date();
            this.currentChat.lastMessage = text;
            
            // Очищаем поле ввода
            messageInput.value = '';
            messageInput.style.height = 'auto';
            
            // Рендерим сообщения
            this.renderMessages();
            this.scrollToBottom();
            
            // Обновляем список чатов
            this.renderChatsList();
            
            // Сохраняем
            this.saveToStorage();
            
            this.showMessage('Сообщение отправлено', 'success');
            
        } catch (error) {
            console.error('❌ Error sending message:', error);
            this.showMessage('Ошибка отправки сообщения', 'error');
        } finally {
            this.toggleSendButtonState(sendBtn, false);
            messageInput.focus();
        }
    }

    toggleSendButtonState(button, isLoading) {
        if (!button) return;
        
        const icon = button.querySelector('i');
        if (isLoading) {
            button.disabled = true;
            button.classList.add('loading');
            if (icon) icon.className = 'fas fa-spinner fa-spin';
        } else {
            button.disabled = false;
            button.classList.remove('loading');
            if (icon) icon.className = 'fas fa-paper-plane';
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
                
                html += dateMessages.map(message => {
                    const isOwnMessage = message.senderId === this.currentUser.id;
                    const messageTime = this.formatTime(message.timestamp);
                    const messageDate = new Date(message.timestamp);
                    const now = new Date();
                    const isToday = messageDate.toDateString() === now.toDateString();
                    const timeDisplay = isToday ? messageTime : `${this.formatDate(messageDate)} ${messageTime}`;
                    
                    return `
                    <div class="message ${isOwnMessage ? 'sent' : 'received'}">
                        <div class="message-content">
                            ${!isOwnMessage ? `
                                <div class="message-sender">${this.escapeHtml(message.sender)}</div>
                            ` : ''}
                            <div class="message-bubble">
                                <div class="message-text">${this.escapeHtml(message.text)}</div>
                                <div class="message-time">
                                    ${timeDisplay}
                                    ${isOwnMessage ? `
                                        <div class="message-status">
                                            <i class="fas fa-check${this.ably && this.ably.connection.state === 'connected' ? '-double' : ''}"></i>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                `}).join('');
            });

            messagesContainer.innerHTML = html;
            this.scrollToBottom();
        }
    }

    scrollToBottom() {
        const messagesContainer = document.querySelector('.messages-container');
        if (messagesContainer) {
            // Небольшая задержка для гарантии рендеринга DOM
            setTimeout(() => {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }, 50);
        }
    }

    openChat(chatId) {
        this.currentChat = this.chats.find(chat => chat.id === chatId);
        
        if (this.currentChat) {
            // Настраиваем реальное время для чата
            this.setupChatRealtime(chatId);
            
            const welcomeScreen = document.querySelector('.welcome-screen');
            const activeChat = document.querySelector('.active-chat');
            const mobileHeader = document.querySelector('.mobile-chat-header');
            
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            if (activeChat) activeChat.style.display = 'flex';
            
            if (window.innerWidth <= 768 && mobileHeader) {
                mobileHeader.style.display = 'flex';
                const mobilePartnerName = document.getElementById('mobilePartnerName');
                const mobileChatAvatar = document.getElementById('mobileChatAvatar');
                if (mobilePartnerName) mobilePartnerName.textContent = this.currentChat.name;
                if (mobileChatAvatar) {
                    mobileChatAvatar.textContent = this.currentChat.name.charAt(0).toUpperCase();
                    mobileChatAvatar.style.background = this.getRandomColor();
                }
            } else {
                const partnerName = document.querySelector('.partner-name');
                const partnerAvatar = document.querySelector('.partner-avatar .avatar-placeholder');
                if (partnerName) {
                    partnerName.textContent = this.currentChat.name;
                }
                if (partnerAvatar) {
                    partnerAvatar.textContent = this.currentChat.name.charAt(0).toUpperCase();
                    partnerAvatar.style.background = this.getRandomColor();
                }
            }
            
            // Сбрасываем счетчик непрочитанных
            this.currentChat.unread = 0;
            
            // Рендерим сообщения
            this.renderMessages();
            
            // Обновляем список чатов
            this.renderChatsList();
            
            // Фокусируемся на поле ввода
            setTimeout(() => {
                const messageInput = document.querySelector('.message-input');
                if (messageInput) {
                    messageInput.focus();
                }
            }, 100);
            
            // Закрываем сайдбар на мобильных
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) {
                    sidebar.classList.remove('active');
                }
            }
            
            // Сохраняем текущий чат
            this.saveToStorage();
            
        } else {
            this.showMessage('Чат не найден', 'error');
            this.hideChat();
        }
    }

    renderChatsList(chatsToRender = null) {
        const chatsList = document.querySelector('.chats-list');
        const emptyState = document.querySelector('#chatsTab .empty-state');
        const chatsCount = document.getElementById('chatsCount');

        if (!chatsList || !emptyState) return;

        const visibleChats = (chatsToRender || this.chats).filter(chat => !chat.hidden);
        const chats = chatsToRender || visibleChats;

        if (chatsCount) {
            chatsCount.textContent = chats.length;
        }

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
                const lastActivityTime = this.getTimeAgo(chat.lastActivity);
                const isActive = this.currentChat?.id === chat.id;
                
                return `
                <div class="chat-item ${isActive ? 'active' : ''}" 
                     onclick="messenger.openChat('${chat.id}')">
                    <div class="chat-avatar">
                        <div class="avatar-placeholder">${chat.name.charAt(0).toUpperCase()}</div>
                        ${chat.isFriendChat ? `<div class="online-status"></div>` : ''}
                    </div>
                    <div class="chat-content">
                        <div class="chat-header">
                            <div class="chat-name">${this.escapeHtml(chat.name)}</div>
                            <div class="chat-time">${lastActivityTime}</div>
                        </div>
                        <div class="chat-preview">
                            <div class="last-message">
                                ${lastMessage ? 
                                    (lastMessage.senderId === this.currentUser.id ? 'Вы: ' : '') + 
                                    this.escapeHtml(this.truncateText(lastMessage.text, 30)) : 
                                    'Нет сообщений'}
                            </div>
                            ${unreadCount > 0 ? `
                                <div class="unread-badge">
                                    ${unreadCount > 99 ? '99+' : unreadCount}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="chat-item-actions">
                        <button class="chat-item-action-btn close" onclick="messenger.leaveChat('${chat.id}', event)" title="Выйти из чата">
                            <i class="fas fa-sign-out-alt"></i>
                        </button>
                    </div>
                </div>
            `}).join('');
        }
    }

    renderFriendsList(friendsToRender = null) {
        const friendsList = document.querySelector('.friends-list');
        const emptyState = document.querySelector('#friendsTab .empty-state');
        const friendsCount = document.getElementById('friendsCount');

        if (!friendsList || !emptyState) return;

        const friends = friendsToRender || this.friends;

        if (friendsCount) {
            friendsCount.textContent = friends.length;
        }

        if (friends.length === 0) {
            friendsList.style.display = 'none';
            emptyState.style.display = 'flex';
        } else {
            friendsList.style.display = 'block';
            emptyState.style.display = 'none';
            
            friendsList.innerHTML = friends.map(friend => {
                const lastSeenTime = this.getTimeAgo(friend.lastSeen);
                const isOnline = friend.status === 'online';
                
                return `
                <div class="friend-item">
                    <div class="friend-avatar">
                        <div class="avatar-placeholder small" style="background: ${friend.avatarColor}">
                            ${friend.avatar}
                        </div>
                        <div class="online-status ${isOnline ? '' : 'away'}"></div>
                    </div>
                    <div class="friend-content">
                        <div class="friend-header">
                            <div class="friend-name">${this.escapeHtml(friend.name)}</div>
                            <div class="friend-status ${isOnline ? 'status-online' : 'status-offline'}">
                                ${isOnline ? 'online' : lastSeenTime}
                            </div>
                        </div>
                        <div class="friend-last-seen">
                            ${isOnline ? 'В сети' : `Был(а) ${lastSeenTime}`}
                        </div>
                    </div>
                    <div class="friend-actions">
                        <button class="friend-action-btn chat" onclick="messenger.startChatWithFriend('${friend.id}')" title="Написать сообщение">
                            <i class="fas fa-comment"></i>
                        </button>
                        <button class="friend-action-btn remove" onclick="messenger.removeFriend('${friend.id}')" title="Удалить друга">
                            <i class="fas fa-user-times"></i>
                        </button>
                    </div>
                </div>
            `}).join('');
        }
    }

    startChatWithFriend(friendId) {
        const friend = this.friends.find(f => f.id === friendId);
        if (!friend) {
            this.showMessage('Друг не найден', 'error');
            return;
        }

        const chatId = 'friend_chat_' + friendId;
        
        let chat = this.chats.find(c => c.id === chatId);
        
        if (!chat) {
            chat = {
                id: chatId,
                name: friend.name,
                messages: [],
                unread: 0,
                lastActivity: new Date(),
                created: new Date(),
                isFriendChat: true,
                friendId: friend.id,
                hidden: false
            };

            this.chats.unshift(chat);
            
            if (!this.messages.has(chat.id)) {
                this.messages.set(chat.id, []);
            }
            
            this.saveToStorage();
            this.renderChatsList();
            
            if (this.ably) {
                this.subscribeToChat(chatId);
            }
        }

        this.openChat(chat.id);
        this.switchTab('chats');
        
        this.showMessage(`Чат с ${friend.name} открыт`, 'success');
    }

    removeFriend(friendId) {
        const friend = this.friends.find(f => f.id === friendId);
        if (friend) {
            if (!confirm(`Вы уверены, что хотите удалить ${friend.name} из друзей?`)) {
                return;
            }

            this.usedNames.delete(friend.name);
            this.friends = this.friends.filter(f => f.id !== friendId);
            
            // Скрываем чат с другом вместо удаления
            this.chats.forEach(chat => {
                if (chat.isFriendChat && chat.friendId === friendId) {
                    chat.hidden = true;
                }
            });
            
            this.saveToStorage();
            this.renderFriendsList();
            this.renderChatsList();
            
            this.showMessage(`Друг "${friend.name}" удален`, 'success');
        } else {
            this.showMessage('Друг не найден', 'error');
        }
    }

    joinTestChat() {
        const testChatId = 'test_chat_global';
        const testChatName = 'Тестовый чат (глобальный)';
        
        let chat = this.chats.find(c => c.id === testChatId);
        
        if (!chat) {
            chat = {
                id: testChatId,
                name: testChatName,
                messages: [],
                unread: 0,
                lastActivity: new Date(),
                created: new Date(),
                isFriendChat: false,
                hidden: false
            };

            this.chats.unshift(chat);
            
            if (!this.messages.has(chat.id)) {
                this.messages.set(chat.id, []);
            }
            
            this.saveToStorage();
            this.renderChatsList();
            
            if (this.ably) {
                this.subscribeToChat(testChatId);
            }
        }

        this.openChat(chat.id);
        this.switchTab('chats');
        
        this.showMessage('Вы вошли в тестовый чат', 'success');
        
        // Отправляем тестовое сообщение
        setTimeout(() => {
            const testMessage = {
                id: 'test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                text: `Привет всем! Это тестовое сообщение от ${this.currentUser.fullName}. Этот чат виден всем пользователям.`,
                sender: this.currentUser.fullName,
                senderId: this.currentUser.id,
                timestamp: new Date().toISOString(),
                chatId: testChatId
            };
            
            if (this.ably && this.channel) {
                this.channel.publish('message', {
                    message: testMessage,
                    sender: this.currentUser.fullName,
                    chatId: testChatId
                });
            } else {
                // В локальном режиме добавляем сообщение напрямую
                this.handleIncomingMessage({
                    message: testMessage,
                    sender: this.currentUser.fullName,
                    chatId: testChatId
                }, testChatId);
            }
        }, 1000);
    }

    showNotification(title, message) {
        // Проверяем разрешение на уведомления
        if ("Notification" in window && Notification.permission === "granted") {
            try {
                const notification = new Notification(title, { 
                    body: message,
                    icon: '/favicon.ico',
                    tag: 'rurum-notification'
                });
                
                // Закрываем уведомление через 5 секунд
                setTimeout(() => {
                    notification.close();
                }, 5000);
                
            } catch (error) {
                console.error('❌ Error showing notification:', error);
            }
        }
        
        // Также показываем сообщение в интерфейсе
        this.showMessage(`${title}: ${message.substring(0, 50)}...`, 'info');
    }

    formatTime(date) {
        try {
            const d = new Date(date);
            return d.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
        } catch (error) {
            return '--:--';
        }
    }

    formatDate(date) {
        try {
            const d = new Date(date);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            
            if (d.toDateString() === today.toDateString()) {
                return 'Сегодня';
            } else if (d.toDateString() === yesterday.toDateString()) {
                return 'Вчера';
            } else {
                return d.toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long'
                });
            }
        } catch (error) {
            return '--';
        }
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    saveToStorage() {
        try {
            const data = {
                version: '1.0',
                chats: this.chats,
                friends: this.friends,
                user: this.currentUser,
                usedNames: Array.from(this.usedNames),
                messages: Array.from(this.messages.entries()),
                friendRequests: this.friendRequests,
                sentRequests: this.sentRequests,
                currentChatId: this.currentChat?.id || null,
                savedAt: new Date().toISOString()
            };
            localStorage.setItem('rurum-data', JSON.stringify(data));
        } catch (error) {
            console.error('❌ Error saving data:', error);
            // Пробуем сохранить без messages если они слишком большие
            try {
                const data = {
                    version: '1.0',
                    chats: this.chats,
                    friends: this.friends,
                    user: this.currentUser,
                    usedNames: Array.from(this.usedNames),
                    friendRequests: this.friendRequests,
                    sentRequests: this.sentRequests,
                    currentChatId: this.currentChat?.id || null,
                    savedAt: new Date().toISOString()
                };
                localStorage.setItem('rurum-data', JSON.stringify(data));
            } catch (e) {
                console.error('❌ Critical error saving data:', e);
            }
        }
    }

    loadFromStorage() {
        try {
            const saved = localStorage.getItem('rurum-data');
            if (saved) {
                const data = JSON.parse(saved);
                
                // Проверяем версию данных
                if (!data.version) {
                    console.warn('⚠️ Loading legacy data format');
                }
                
                this.chats = data.chats || [];
                this.friends = data.friends || [];
                this.currentUser = { ...this.currentUser, ...data.user };
                this.usedNames = new Set(data.usedNames || ['Пользователь']);
                this.messages = new Map(data.messages || []);
                this.friendRequests = data.friendRequests || [];
                this.sentRequests = data.sentRequests || [];
                
                // Восстанавливаем текущий чат если есть
                if (data.currentChatId) {
                    this.currentChat = this.chats.find(c => c.id === data.currentChatId);
                }
                
                this.updateRequestsBadge();
                
                console.log('📂 Loaded data from storage:', {
                    chats: this.chats.length,
                    friends: this.friends.length,
                    messages: this.messages.size,
                    friendRequests: this.friendRequests.length
                });
            } else {
                console.log('📂 No saved data found, starting fresh');
                this.resetData();
            }
        } catch (e) {
            console.error('❌ Error loading data from storage:', e);
            this.resetData();
        }
    }

    resetData() {
        this.chats = [];
        this.friends = [];
        this.friendRequests = [];
        this.sentRequests = [];
        this.usedNames = new Set(['Пользователь']);
        this.messages = new Map();
        this.currentChat = null;
        
        // Создаем тестовый чат для новых пользователей
        this.joinTestChat();
    }

    showMessage(message, type = 'success') {
        // Убираем существующие уведомления
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(notification => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        });
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-${type === 'success' ? 'check' : 
                                  type === 'error' ? 'exclamation-triangle' : 
                                  type === 'warning' ? 'exclamation-circle' : 'info-circle'}"></i>
                <span>${message}</span>
            </div>
        `;

        document.body.appendChild(notification);

        // Анимация появления
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);

        // Убираем через 3 секунды
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }
}

// Инициализация приложения
console.log('🚀 Starting Rurum Messenger...');

// Проверяем поддержку необходимых API
if (typeof localStorage === 'undefined') {
    alert('Ваш браузер не поддерживает localStorage. Приложение не может работать.');
    throw new Error('localStorage is not supported');
}

// Создаем глобальный объект мессенджера
const messenger = new RurumMessenger();
window.messenger = messenger;

// Глобальные функции для отладки
window.debugData = () => {
    console.log('🐛 DEBUG DATA:');
    console.log('=== CURRENT USER ===');
    console.log('ID:', messenger.currentUser.id);
    console.log('Name:', messenger.currentUser.fullName);
    console.log('Theme:', messenger.currentUser.theme);
    
    console.log('\n=== FRIEND REQUESTS ===');
    console.log('Incoming:', messenger.friendRequests.length);
    console.log('Sent:', messenger.sentRequests.length);
    messenger.friendRequests.forEach((req, i) => {
        console.log(`  ${i+1}. From: ${req.fromUserName}, ID: ${req.id}`);
    });
    
    console.log('\n=== FRIENDS ===');
    console.log('Count:', messenger.friends.length);
    messenger.friends.forEach((friend, i) => {
        console.log(`  ${i+1}. ${friend.name} (${friend.status})`);
    });
    
    console.log('\n=== CHATS ===');
    console.log('Count:', messenger.chats.length);
    messenger.chats.forEach((chat, i) => {
        console.log(`  ${i+1}. ${chat.name} (${chat.id})`);
        console.log(`     Messages: ${messenger.messages.get(chat.id)?.length || 0}`);
        console.log(`     Unread: ${chat.unread || 0}`);
    });
    
    console.log('\n=== LOCAL STORAGE ===');
    const allKeys = Object.keys(localStorage);
    allKeys.forEach(key => {
        if (key.startsWith('rurum')) {
            try {
                const value = JSON.parse(localStorage.getItem(key));
                console.log(`${key}:`, value ? '✓' : '✗');
            } catch {
                console.log(`${key}:`, localStorage.getItem(key)?.substring(0, 50) + '...');
            }
        }
    });
    
    console.log('\n=== ABLY ===');
    if (messenger.ably) {
        console.log('State:', messenger.ably.connection.state);
        console.log('Channels:', messenger.ablyChannels.size);
    } else {
        console.log('Not initialized');
    }
    
    messenger.showMessage('Данные выведены в консоль', 'info');
};

window.testAbly = () => {
    if (messenger.ably) {
        console.log('🔧 Ably connection state:', messenger.ably.connection.state);
        console.log('🔧 Ably connection ID:', messenger.ably.connection.id);
        console.log('🔧 Active channels:', messenger.ablyChannels.size);
        
        messenger.showMessage(`Ably: ${messenger.ably.connection.state}`, 'info');
        
        // Тестовое сообщение в консоль
        if (messenger.currentChat && messenger.channel) {
            console.log('🔧 Current channel:', messenger.channel.name);
        }
    } else {
        console.log('❌ Ably not initialized');
        messenger.showMessage('Ably не инициализирован', 'error');
    }
};

window.clearData = () => {
    if (confirm('ВНИМАНИЕ: Это очистит ВСЕ данные (чаты, друзья, сообщения). Продолжить?')) {
        const allKeys = Object.keys(localStorage);
        allKeys.forEach(key => {
            if (key.startsWith('rurum')) {
                localStorage.removeItem(key);
            }
        });
        
        // Перезагружаем страницу
        setTimeout(() => {
            location.reload();
        }, 100);
    }
};

window.joinTest = () => {
    messenger.joinTestChat();
};

window.leaveChat = (chatId) => {
    messenger.leaveChat(chatId);
};

window.checkFriendRequestsNow = () => {
    messenger.checkPendingFriendRequests();
    messenger.checkFriendResponses();
    messenger.showMessage('Проверка заявок выполнена', 'info');
};

window.createTestFriendRequest = () => {
    const fromName = prompt('Введите имя отправителя (например: Андрей):', 'Андрей');
    const toName = prompt('Введите имя получателя (например: Мария):', 'Мария');
    
    if (fromName && toName) {
        const requestId = 'test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const testRequest = {
            id: requestId,
            fromUserId: 'test_' + fromName,
            fromUserName: fromName,
            toUserName: toName,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        
        messenger.saveFriendRequestToStorage(testRequest);
        
        // Обновляем интерфейс
        messenger.checkPendingFriendRequests();
        
        alert(`Тестовая заявка создана!\n\nОт: ${fromName}\nКому: ${toName}\n\nНа устройстве пользователя "${toName}" нажмите "Проверить заявки".`);
        
        messenger.showMessage(`Тестовая заявка создана для ${toName}`, 'success');
    }
};

window.clearFriendRequests = () => {
    if (confirm('Очистить все заявки и ответы?')) {
        localStorage.removeItem('rurum_friend_requests');
        localStorage.removeItem('rurum_friend_responses');
        
        messenger.friendRequests = [];
        messenger.sentRequests = [];
        messenger.updateRequestsBadge();
        messenger.saveToStorage();
        
        messenger.showMessage('Все заявки очищены', 'success');
    }
};

window.sendTestMessage = () => {
    if (!messenger.currentChat) {
        messenger.showMessage('Сначала откройте чат', 'warning');
        return;
    }
    
    const testMessage = {
        id: 'test_' + Date.now(),
        text: `Тестовое сообщение от ${messenger.currentUser.fullName} в ${new Date().toLocaleTimeString()}`,
        sender: messenger.currentUser.fullName,
        senderId: messenger.currentUser.id,
        timestamp: new Date().toISOString(),
        chatId: messenger.currentChat.id
    };
    
    if (messenger.ably && messenger.channel) {
        messenger.channel.publish('message', {
            message: testMessage,
            sender: messenger.currentUser.fullName,
            chatId: messenger.currentChat.id
        });
        messenger.showMessage('Тестовое сообщение отправлено через Ably', 'success');
    } else {
        messenger.handleIncomingMessage({
            message: testMessage,
            sender: 'Тестовая система',
            chatId: messenger.currentChat.id
        }, messenger.currentChat.id);
        messenger.showMessage('Тестовое сообщение добавлено локально', 'info');
    }
};

// Инициализация при загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM loaded, initializing messenger...');
    
    // Плавное появление
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';
    
    // Инициализируем мессенджер
    try {
        messenger.init();
    } catch (error) {
        console.error('❌ Error initializing messenger:', error);
        alert('Произошла ошибка при инициализации мессенджера. Проверьте консоль для подробностей.');
        document.body.innerHTML = `
            <div style="padding: 20px; text-align: center; font-family: Arial, sans-serif;">
                <h1 style="color: #e74c3c;">Ошибка загрузки</h1>
                <p>Произошла ошибка при загрузке мессенджера.</p>
                <p>Пожалуйста, обновите страницу или проверьте консоль браузера.</p>
                <button onclick="location.reload()" style="padding: 10px 20px; background: #f6a75e; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Обновить страницу
                </button>
            </div>
        `;
        return;
    }
    
    // Плавное появление
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
    
    // Добавляем стили для уведомлений
    const style = document.createElement('style');
    style.textContent = `
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            color: white;
            font-size: 14px;
            z-index: 10000;
            opacity: 0;
            transform: translateX(100%);
            transition: opacity 0.3s, transform 0.3s;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .notification.show {
            opacity: 1;
            transform: translateX(0);
        }
        
        .notification.success {
            background: #27ae60;
            border-left: 4px solid #219653;
        }
        
        .notification.error {
            background: #e74c3c;
            border-left: 4px solid #c0392b;
        }
        
        .notification.warning {
            background: #f39c12;
            border-left: 4px solid #e67e22;
        }
        
        .notification.info {
            background: #3498db;
            border-left: 4px solid #2980b9;
        }
        
        .notification-content {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .notification-content i {
            font-size: 16px;
        }
    `;
    document.head.appendChild(style);
});

// Экспортируем для использования в консоли
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RurumMessenger, messenger };
}