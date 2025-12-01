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
        
        // Проверяем сохраненные заявки и ответы сразу
        setTimeout(() => {
            this.checkAllStoredData();
        }, 500);
        
        // Запрашиваем разрешение на уведомления
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
        
        this.isInitialized = true;
        console.log('✅ Messenger initialized');
    }

    setupCrossTabCommunication() {
        try {
            // Используем BroadcastChannel для общения между вкладками
            if ('BroadcastChannel' in window) {
                this.broadcastChannel = new BroadcastChannel('rurum_messenger');
                
                this.broadcastChannel.onmessage = (event) => {
                    this.handleBroadcastMessage(event.data);
                };
                
                console.log('📡 BroadcastChannel initialized for cross-tab communication');
            }
            
            // Также слушаем события localStorage как fallback
            window.addEventListener('storage', (event) => {
                this.handleStorageEvent(event);
            });
            
        } catch (error) {
            console.error('❌ Error setting up cross-tab communication:', error);
        }
    }

    handleBroadcastMessage(data) {
        console.log('📨 Broadcast message received:', data);
        
        if (!data || !data.type) return;
        
        switch (data.type) {
            case 'friend_request':
                this.processIncomingFriendRequest(data.request);
                break;
            case 'friend_response':
                this.processFriendResponse(data.response);
                break;
            case 'sync_request':
                this.sendAllPendingRequests();
                break;
        }
    }

    handleStorageEvent(event) {
        try {
            if (event.key === 'rurum_friend_requests_data' && event.newValue) {
                const data = JSON.parse(event.newValue);
                if (data.type === 'friend_request') {
                    this.processIncomingFriendRequest(data.request);
                }
            } else if (event.key === 'rurum_friend_responses_data' && event.newValue) {
                const data = JSON.parse(event.newValue);
                if (data.type === 'friend_response') {
                    this.processFriendResponse(data.response);
                }
            }
        } catch (error) {
            console.error('❌ Error handling storage event:', error);
        }
    }

    // СИСТЕМА ЗАЯВОК В ДРУЗЬЯ
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
        
        this.saveToStorage();
        this.hideAddFriendModal();
        
        // Сохраняем заявку в глобальное хранилище
        this.saveFriendRequestToGlobalStorage(friendRequest);
        
        // Отправляем заявку через все каналы
        this.broadcastFriendRequest(friendRequest);
        
        // Также сохраняем в localStorage для немедленного доступа
        this.saveToLocalStorageImmediate('friend_request', friendRequest);
        
        this.showMessage(`Заявка отправлена пользователю ${friendName}. Откройте приложение на другом устройстве под именем "${friendName}" чтобы получить заявку.`, 'success');
        console.log('✅ Friend request sent:', friendName);
    }

    saveFriendRequestToGlobalStorage(request) {
        try {
            const key = `rurum_friend_request_${request.id}`;
            const requestData = {
                ...request,
                storedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            };
            
            localStorage.setItem(key, JSON.stringify(requestData));
            console.log('💾 Friend request saved to global storage with key:', key);
            
            // Также сохраняем в общий индекс
            this.updateFriendRequestsIndex(request.id, request.toUserName);
            
        } catch (error) {
            console.error('❌ Error saving friend request to global storage:', error);
        }
    }

    updateFriendRequestsIndex(requestId, toUserName) {
        try {
            const indexKey = 'rurum_friend_requests_index';
            let index = JSON.parse(localStorage.getItem(indexKey) || '{}');
            
            if (!index[toUserName]) {
                index[toUserName] = [];
            }
            
            if (!index[toUserName].includes(requestId)) {
                index[toUserName].push(requestId);
            }
            
            if (index[toUserName].length > 10) {
                index[toUserName] = index[toUserName].slice(-10);
            }
            
            localStorage.setItem(indexKey, JSON.stringify(index));
            
        } catch (error) {
            console.error('❌ Error updating friend requests index:', error);
        }
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
            
            // Также сохраняем в localStorage для других вкладок
            localStorage.setItem('rurum_last_friend_request', JSON.stringify(broadcastData));
            
            console.log('📤 Friend request broadcasted');
            
        } catch (error) {
            console.error('❌ Error broadcasting friend request:', error);
        }
    }

    saveToLocalStorageImmediate(type, data) {
        try {
            const key = type === 'friend_request' ? 'rurum_friend_requests_data' : 'rurum_friend_responses_data';
            const storageData = {
                type: type,
                data: data,
                timestamp: Date.now()
            };
            
            localStorage.setItem(key, JSON.stringify(storageData));
            
            setTimeout(() => {
                localStorage.removeItem(key);
            }, 100);
            
        } catch (error) {
            console.error('❌ Error saving to localStorage immediate:', error);
        }
    }

    checkAllStoredData() {
        console.log('🔍 Checking all stored friend data...');
        
        // 1. Проверяем заявки по индексу
        this.checkFriendRequestsByIndex();
        
        // 2. Проверяем последнюю заявку в localStorage
        this.checkLastFriendRequest();
        
        // 3. Проверяем ответы
        this.checkStoredFriendResponses();
        
        // 4. Отправляем запрос на синхронизацию
        this.requestSync();
    }

    checkFriendRequestsByIndex() {
        try {
            const myName = this.currentUser.fullName;
            const indexKey = 'rurum_friend_requests_index';
            const index = JSON.parse(localStorage.getItem(indexKey) || '{}');
            
            console.log('🔍 Checking friend requests index for:', myName);
            
            if (index[myName] && Array.isArray(index[myName])) {
                const requestIds = index[myName];
                console.log('Found request IDs for me:', requestIds);
                
                requestIds.forEach(requestId => {
                    this.processStoredFriendRequest(requestId);
                });
            }
            
        } catch (error) {
            console.error('❌ Error checking friend requests by index:', error);
        }
    }

    processStoredFriendRequest(requestId) {
        try {
            const key = `rurum_friend_request_${requestId}`;
            const storedData = localStorage.getItem(key);
            
            if (!storedData) return;
            
            const requestData = JSON.parse(storedData);
            
            // Проверяем срок годности
            const expiresAt = new Date(requestData.expiresAt);
            if (expiresAt < new Date()) {
                console.log('🗑️ Expired friend request, removing:', requestId);
                localStorage.removeItem(key);
                this.removeFromIndex(requestId, requestData.toUserName);
                return;
            }
            
            // Проверяем, адресована ли заявка текущему пользователю
            if (requestData.toUserName !== this.currentUser.fullName) return;
            
            // Проверяем, не наша ли это собственная заявка
            if (requestData.fromUserId === this.currentUser.id) return;
            
            // Проверяем, нет ли уже такой заявки
            const existingRequest = this.friendRequests.find(req => req.id === requestData.id);
            if (existingRequest) return;
            
            console.log('📨 Processing stored friend request:', requestData);
            
            // Добавляем заявку
            const newRequest = {
                id: requestData.id,
                fromUserId: requestData.fromUserId,
                fromUserName: requestData.fromUserName,
                timestamp: requestData.timestamp,
                status: 'pending'
            };
            
            this.friendRequests.push(newRequest);
            this.updateRequestsBadge();
            this.saveToStorage();
            
            // Показываем уведомление
            this.showNotification('Новая заявка в друзья', 
                `${newRequest.fromUserName} хочет добавить вас в друзья`);
            this.showMessage(`Новая заявка в друзья от ${newRequest.fromUserName}`, 'info');
            
            // Обновляем интерфейс
            this.renderFriendRequests();
            
            // Удаляем из хранилища после обработки
            localStorage.removeItem(key);
            this.removeFromIndex(requestData.id, requestData.toUserName);
            
        } catch (error) {
            console.error('❌ Error processing stored friend request:', error);
        }
    }

    removeFromIndex(requestId, toUserName) {
        try {
            const indexKey = 'rurum_friend_requests_index';
            let index = JSON.parse(localStorage.getItem(indexKey) || '{}');
            
            if (index[toUserName]) {
                index[toUserName] = index[toUserName].filter(id => id !== requestId);
                if (index[toUserName].length === 0) {
                    delete index[toUserName];
                }
                localStorage.setItem(indexKey, JSON.stringify(index));
            }
            
        } catch (error) {
            console.error('❌ Error removing from index:', error);
        }
    }

    checkLastFriendRequest() {
        try {
            const lastRequestData = localStorage.getItem('rurum_last_friend_request');
            if (!lastRequestData) return;
            
            const data = JSON.parse(lastRequestData);
            if (data.type === 'friend_request') {
                this.processIncomingFriendRequest(data.request);
            }
            
        } catch (error) {
            console.error('❌ Error checking last friend request:', error);
        }
    }

    processIncomingFriendRequest(request) {
        // Проверяем, адресована ли заявка текущему пользователю
        if (request.toUserName !== this.currentUser.fullName) {
            console.log('📭 Friend request not for current user:', request.toUserName);
            return;
        }
        
        // Проверяем, нет ли уже такой заявки
        const existingRequest = this.friendRequests.find(req => req.id === request.id);
        if (existingRequest) {
            console.log('📭 Duplicate friend request, ignoring:', request.id);
            return;
        }
        
        // Проверяем, не отправили ли мы сами эту заявку
        if (request.fromUserId === this.currentUser.id) {
            console.log('📭 Our own friend request, ignoring');
            return;
        }
        
        console.log('📨 Processing incoming friend request:', request);
        
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
        this.showMessage(`Новая заявка в друзья от ${newRequest.fromUserName}`, 'info');
        
        // Обновляем интерфейс
        this.renderFriendRequests();
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
            
            // Сохраняем ответ в глобальное хранилище
            this.saveFriendResponseToGlobalStorage(response);
            
            // Отправляем через BroadcastChannel
            if (this.broadcastChannel) {
                this.broadcastChannel.postMessage({
                    type: 'friend_response',
                    response: response,
                    timestamp: Date.now()
                });
            }
            
            // Сохраняем в localStorage для немедленного доступа
            this.saveToLocalStorageImmediate('friend_response', response);
            
            console.log('📤 Friend response sent:', response);
            
        } catch (error) {
            console.error('❌ Error sending friend response:', error);
        }
    }

    saveFriendResponseToGlobalStorage(response) {
        try {
            const key = `rurum_friend_response_${response.id}`;
            const responseData = {
                ...response,
                storedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            };
            
            localStorage.setItem(key, JSON.stringify(responseData));
            console.log('💾 Friend response saved to global storage with key:', key);
            
        } catch (error) {
            console.error('❌ Error saving friend response to global storage:', error);
        }
    }

    checkStoredFriendResponses() {
        try {
            const myId = this.currentUser.id;
            
            // Ищем все ключи с ответами
            const allKeys = Object.keys(localStorage);
            const responseKeys = allKeys.filter(key => key.startsWith('rurum_friend_response_'));
            
            console.log('🔍 Checking stored friend responses for user:', myId);
            
            responseKeys.forEach(key => {
                try {
                    const storedData = localStorage.getItem(key);
                    if (!storedData) return;
                    
                    const responseData = JSON.parse(storedData);
                    
                    // Проверяем срок годности
                    const expiresAt = new Date(responseData.expiresAt);
                    if (expiresAt < new Date()) {
                        console.log('🗑️ Expired friend response, removing:', key);
                        localStorage.removeItem(key);
                        return;
                    }
                    
                    // Проверяем, адресован ли ответ нам
                    if (responseData.toUserId === myId) {
                        this.processFriendResponse(responseData);
                        // Удаляем после обработки
                        localStorage.removeItem(key);
                    }
                    
                } catch (error) {
                    console.error('❌ Error processing stored response:', error);
                }
            });
            
        } catch (error) {
            console.error('❌ Error checking stored friend responses:', error);
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

    requestSync() {
        // Отправляем запрос на синхронизацию другим вкладкам
        if (this.broadcastChannel) {
            this.broadcastChannel.postMessage({
                type: 'sync_request',
                fromUserId: this.currentUser.id,
                timestamp: Date.now()
            });
        }
    }

    sendAllPendingRequests() {
        // Отправляем все наши отправленные заявки (для синхронизации)
        this.sentRequests.forEach(request => {
            if (request.status === 'pending') {
                const friendRequest = {
                    id: request.id,
                    fromUserId: this.currentUser.id,
                    fromUserName: this.currentUser.fullName,
                    toUserName: request.toUserName,
                    timestamp: request.timestamp,
                    status: 'pending'
                };
                
                this.saveFriendRequestToGlobalStorage(friendRequest);
            }
        });
    }

    startRequestsCheckInterval() {
        // Проверяем заявки каждые 5 секунд
        this.requestsCheckInterval = setInterval(() => {
            this.checkAllStoredData();
        }, 5000);
    }

    stopRequestsCheckInterval() {
        if (this.requestsCheckInterval) {
            clearInterval(this.requestsCheckInterval);
            this.requestsCheckInterval = null;
        }
    }

    initAbly() {
        try {
            console.log('🔌 Initializing Ably with key:', this.ABLY_API_KEY.substring(0, 10) + '...');
            
            this.ably = new Ably.Realtime(this.ABLY_API_KEY);
            
            this.ably.connection.on('connected', () => {
                console.log('✅ Connected to Ably');
                this.showMessage('Подключено к серверу', 'success');
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
            
        } catch (error) {
            console.error('❌ Error initializing Ably:', error);
            this.showMessage('Ошибка инициализации Ably', 'error');
        }
    }

    setupChatChannels() {
        this.chats.forEach(chat => {
            this.subscribeToChat(chat.id);
        });
    }

    subscribeToChat(chatId) {
        if (!this.ably) return;
        
        const chatChannel = this.ably.channels.get(`chat:${chatId}`);
        
        chatChannel.subscribe('message', (message) => {
            this.handleIncomingMessage(message.data, chatId);
        });
        
        console.log(`🎧 Subscribed to chat: ${chatId}`);
    }

    handleIncomingMessage(messageData, chatId) {
        const { message, sender } = messageData;
        
        if (!message) return;
        
        if (!this.messages.has(chatId)) {
            this.messages.set(chatId, []);
        }
        
        const existingMessage = this.messages.get(chatId).find(m => m.id === message.id);
        if (!existingMessage) {
            this.messages.get(chatId).push(message);
        }
        
        if (this.currentChat && this.currentChat.id === chatId) {
            this.renderMessages();
            this.scrollToBottom();
        } else {
            const chat = this.chats.find(c => c.id === chatId);
            if (chat) {
                chat.unread = (chat.unread || 0) + 1;
                this.renderChatsList();
                this.showNotification(`Новое сообщение от ${sender}`, message.text);
            }
        }
        
        this.saveToStorage();
    }

    setupChatRealtime(chatId) {
        if (!this.ably) {
            console.warn('⚠️ Ably not initialized');
            this.showMessage('Сервер не подключен', 'warning');
            return;
        }
        
        if (this.channel) {
            this.channel.unsubscribe();
        }
        
        this.channel = this.ably.channels.get(`chat:${chatId}`);
        
        this.channel.subscribe('message', (message) => {
            this.handleIncomingMessage(message.data, chatId);
        });
        
        this.loadChannelHistory(chatId);
        
        console.log(`🎧 Connected to Ably channel: chat:${chatId}`);
    }

    async loadChannelHistory(chatId) {
        try {
            if (!this.channel) return;
            
            const historyPage = await this.channel.history({ limit: 50 });
            const ablyMessages = historyPage.items
                .map(item => item.data.message)
                .filter(msg => msg)
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            const localMessages = this.messages.get(chatId) || [];
            const allMessages = [...localMessages, ...ablyMessages];
            
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
        document.getElementById('searchInput')?.addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

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
        }
        
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        
        if (this.currentChat && this.currentChat.id === chatId) {
            this.hideChat();
        }
        
        const chatItem = document.querySelector(`.chat-item[onclick*="${chatId}"]`);
        if (chatItem) {
            chatItem.classList.add('closing');
            
            setTimeout(() => {
                this.chats = this.chats.filter(c => c.id !== chatId);
                if (!chat.hidden) chat.hidden = true;
                this.saveToStorage();
                this.renderChatsList();
                this.showMessage(`Вы вышли из чата "${chat.name}"`, 'success');
            }, 400);
        } else {
            this.chats = this.chats.filter(c => c.id !== chatId);
            if (!chat.hidden) chat.hidden = true;
            this.saveToStorage();
            this.renderChatsList();
            this.showMessage(`Вы вышли из чата "${chat.name}"`, 'success');
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

        const chatId = 'chat_' + chatName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        
        let chat = this.chats.find(c => c.id === chatId);
        
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

    showFriendRequestsModal() {
        const modal = document.getElementById('friendRequestsModal');
        if (modal) {
            modal.style.display = 'flex';
            this.renderFriendRequests();
        }
    }

    updateRequestsBadge() {
        const badge = document.getElementById('requestsBadge');
        const requestsBtn = document.getElementById('requestsBtn');
        
        if (badge && requestsBtn) {
            if (this.friendRequests.length > 0) {
                badge.textContent = this.friendRequests.length;
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
    }

    renderFriendRequests() {
        const requestsList = document.getElementById('requestsList');
        const noRequestsMessage = document.getElementById('noRequestsMessage');
        
        if (!requestsList || !noRequestsMessage) return;

        if (this.friendRequests.length === 0) {
            requestsList.style.display = 'none';
            noRequestsMessage.style.display = 'block';
        } else {
            requestsList.style.display = 'block';
            noRequestsMessage.style.display = 'none';
            
            requestsList.innerHTML = this.friendRequests.map(request => `
                <div class="request-item">
                    <div class="request-info">
                        <div class="avatar-placeholder small" style="background: ${this.getRandomColor()}">
                            ${request.fromUserName.charAt(0)}
                        </div>
                        <div>
                            <div class="friend-name">${this.escapeHtml(request.fromUserName)}</div>
                            <div class="request-time">${this.formatTime(request.timestamp)}</div>
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
            `).join('');
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
            if (!this.channel) {
                this.setupChatRealtime(this.currentChat.id);
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

            await this.channel.publish('message', {
                message: message,
                sender: this.currentUser.fullName,
                chatId: this.currentChat.id
            });

            if (!this.messages.has(this.currentChat.id)) {
                this.messages.set(this.currentChat.id, []);
            }
            
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
        this.currentChat = this.chats.find(chat => chat.id === chatId);
        
        if (this.currentChat) {
            if (this.ably) {
                this.setupChatRealtime(chatId);
            }
            
            const welcomeScreen = document.querySelector('.welcome-screen');
            const activeChat = document.querySelector('.active-chat');
            const mobileHeader = document.querySelector('.mobile-chat-header');
            
            if (welcomeScreen) welcomeScreen.style.display = 'none';
            if (activeChat) activeChat.style.display = 'flex';
            
            if (window.innerWidth <= 768 && mobileHeader) {
                mobileHeader.style.display = 'flex';
                document.getElementById('mobilePartnerName').textContent = this.currentChat.name;
                document.getElementById('mobileChatAvatar').textContent = this.currentChat.name.charAt(0);
            } else {
                const partnerName = document.querySelector('.partner-name');
                if (partnerName) {
                    partnerName.textContent = this.currentChat.name;
                }
            }
            
            this.currentChat.unread = 0;
            this.renderMessages();
            this.renderChatsList();
            
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                if (sidebar) {
                    sidebar.classList.remove('active');
                }
            }
        } else {
            this.showMessage('Чат не найден', 'error');
        }
    }

    renderChatsList(chatsToRender = null) {
        const chatsList = document.querySelector('.chats-list');
        const emptyState = document.querySelector('#chatsTab .empty-state');

        if (!chatsList || !emptyState) return;

        const visibleChats = (chatsToRender || this.chats).filter(chat => !chat.hidden);
        const chats = chatsToRender || visibleChats;

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
                    <div class="chat-item-actions">
                        <button class="chat-item-action-btn close" onclick="messenger.leaveChat('${chat.id}', event)" title="Закрыть чат">
                            <i class="fas fa-times"></i>
                        </button>
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
            
            this.chats = this.chats.filter(chat => !(chat.isFriendChat && chat.friendId === friendId));
            
            this.saveToStorage();
            this.renderFriendsList();
            this.renderChatsList();
            
            this.showMessage(`Друг "${friend.name}" удален`, 'success');
        } else {
            this.showMessage('Друг не найден', 'error');
        }
    }

    joinTestChat() {
        const testChatId = 'test_chat_123';
        const testChatName = 'Тестовый чат';
        
        let chat = this.chats.find(c => c.id === testChatId);
        
        if (!chat) {
            chat = {
                id: testChatId,
                name: testChatName,
                messages: [],
                unread: 0,
                lastActivity: new Date(),
                created: new Date(),
                isFriendChat: false
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
        
        setTimeout(() => {
            const testMessage = {
                id: 'test_' + Date.now(),
                text: `Привет! Это тестовое сообщение от ${this.currentUser.fullName}`,
                sender: this.currentUser.fullName,
                senderId: this.currentUser.id,
                timestamp: new Date().toISOString(),
                chatId: testChatId
            };
            
            if (this.channel) {
                this.channel.publish('message', {
                    message: testMessage,
                    sender: this.currentUser.fullName,
                    chatId: testChatId
                });
            }
        }, 1000);
    }

    showNotification(title, message) {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body: message });
        }
        
        this.showMessage(`Новое сообщение: ${message.substring(0, 30)}...`, 'info');
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
                messages: Array.from(this.messages.entries()),
                friendRequests: this.friendRequests,
                sentRequests: this.sentRequests
            };
            localStorage.setItem('rurum-data', JSON.stringify(data));
        } catch (error) {
            console.error('❌ Error saving data:', error);
        }
    }

    loadFromStorage() {
        const saved = localStorage.getItem('rurum-data');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.chats = data.chats || [];
                this.friends = data.friends || [];
                this.currentUser = { ...this.currentUser, ...data.user };
                this.usedNames = new Set(data.usedNames || ['Пользователь']);
                this.messages = new Map(data.messages || []);
                this.friendRequests = data.friendRequests || [];
                this.sentRequests = data.sentRequests || [];
                this.updateRequestsBadge();
            } catch (e) {
                this.resetData();
            }
        } else {
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
    }

    showMessage(message, type = 'success') {
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
console.log('🚀 Starting Rurum Messenger...');
const messenger = new RurumMessenger();
window.messenger = messenger;

// Глобальные функции
window.debugData = () => {
    console.log('🐛 DEBUG DATA:');
    console.log('Current User:', messenger.currentUser);
    console.log('Friend Requests:', messenger.friendRequests);
    console.log('Sent Requests:', messenger.sentRequests);
    console.log('Friends:', messenger.friends);
    console.log('Chats:', messenger.chats);
    
    const allKeys = Object.keys(localStorage);
    allKeys.forEach(key => {
        if (key.startsWith('rurum')) {
            try {
                const value = JSON.parse(localStorage.getItem(key));
                console.log(`${key}:`, value);
            } catch {
                console.log(`${key}:`, localStorage.getItem(key));
            }
        }
    });
    
    messenger.showMessage('Данные выведены в консоль', 'info');
};

window.testAbly = () => {
    if (messenger.ably) {
        console.log('🔧 Ably connection state:', messenger.ably.connection.state);
        messenger.showMessage(`Ably: ${messenger.ably.connection.state}`, 'info');
    } else {
        console.log('❌ Ably not initialized');
        messenger.showMessage('Ably не инициализирован', 'error');
    }
};

window.clearData = () => {
    if (confirm('Очистить все данные? Это перезагрузит страницу.')) {
        const allKeys = Object.keys(localStorage);
        allKeys.forEach(key => {
            if (key.startsWith('rurum')) {
                localStorage.removeItem(key);
            }
        });
        location.reload();
    }
};

window.joinTest = () => {
    messenger.joinTestChat();
};

window.leaveChat = (chatId) => {
    messenger.leaveChat(chatId);
};

window.checkFriendRequestsNow = () => {
    messenger.checkAllStoredData();
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
        
        messenger.saveFriendRequestToGlobalStorage(testRequest);
        
        alert(`Тестовая заявка создана!\n\nОт: ${fromName}\nКому: ${toName}\n\nНа устройстве пользователя "${toName}" нажмите "Проверить заявки".`);
    }
};

window.clearFriendRequests = () => {
    if (confirm('Очистить все заявки?')) {
        const allKeys = Object.keys(localStorage);
        allKeys.forEach(key => {
            if (key.includes('friend_request') || key.includes('friend_response')) {
                localStorage.removeItem(key);
            }
        });
        
        localStorage.removeItem('rurum_friend_requests_index');
        
        messenger.friendRequests = [];
        messenger.sentRequests = [];
        messenger.updateRequestsBadge();
        messenger.saveToStorage();
        
        messenger.showMessage('Все заявки очищены', 'success');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    messenger.init();
    
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';
    
    setTimeout(() => {
        document.body.style.opacity = '1';