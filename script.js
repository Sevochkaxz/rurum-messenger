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
        
        // НОВОЕ: Система заявок в друзья
        this.friendRequests = []; // Входящие заявки
        this.sentRequests = [];   // Отправленные заявки
        this.notificationChannel = null; // Канал для уведомлений
        
        // НОВОЕ: Для удаления чата
        this.chatToDelete = null;
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
                
                // Подключаемся к каналу уведомлений
                this.setupNotificationChannel();
            });
            
            this.ably.connection.on('disconnected', () => {
                console.warn('⚠️ Disconnected from Ably');
                this.showMessage('Потеряно соединение с серверу', 'warning');
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

    setupNotificationChannel() {
        if (!this.ably) return;
        
        // Создаем персональный канал для уведомлений
        this.notificationChannel = this.ably.channels.get(`user:${this.currentUser.id}`);
        
        // Подписываемся на заявки в друзья
        this.notificationChannel.subscribe('friend_request', (message) => {
            console.log('📨 New friend request received:', message.data);
            this.handleFriendRequest(message.data);
        });
        
        // Подписываемся на ответы на заявки
        this.notificationChannel.subscribe('friend_request_response', (message) => {
            console.log('📨 Friend request response received:', message.data);
            this.handleFriendRequestResponse(message.data);
        });
        
        console.log(`🔔 Notification channel ready: user:${this.currentUser.id}`);
    }

    handleFriendRequest(data) {
        const { fromUserId, fromUserName, requestId } = data;
        
        // Проверяем, нет ли уже такой заявки
        const existingRequest = this.friendRequests.find(req => req.id === requestId);
        if (existingRequest) return;
        
        // Добавляем заявку
        const newRequest = {
            id: requestId,
            fromUserId: fromUserId,
            fromUserName: fromUserName,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        
        this.friendRequests.push(newRequest);
        this.updateRequestsBadge();
        this.saveToStorage();
        
        // Показываем уведомление
        this.showNotification('Новая заявка в друзья', `${fromUserName} хочет добавить вас в друзья`);
        this.showMessage(`Новая заявка в друзья от ${fromUserName}`, 'info');
    }

    handleFriendRequestResponse(data) {
        const { requestId, accepted, fromUserId, fromUserName } = data;
        
        // Находим отправленную заявку
        const sentRequestIndex = this.sentRequests.findIndex(req => req.id === requestId);
        
        if (sentRequestIndex !== -1) {
            const request = this.sentRequests[sentRequestIndex];
            
            if (accepted) {
                // Добавляем в друзья
                const newFriend = {
                    id: fromUserId,
                    name: fromUserName,
                    avatar: fromUserName.charAt(0).toUpperCase(),
                    avatarColor: this.getRandomColor(),
                    status: 'online',
                    lastSeen: new Date(),
                    addedAt: new Date()
                };
                
                this.friends.unshift(newFriend);
                this.usedNames.add(fromUserName);
                
                // Удаляем заявку из отправленных
                this.sentRequests.splice(sentRequestIndex, 1);
                
                this.showMessage(`${fromUserName} принял(а) вашу заявку в друзья!`, 'success');
                
                // Автоматически создаем чат с новым другом
                this.createFriendChat(fromUserId, fromUserName);
            } else {
                // Заявка отклонена
                this.sentRequests.splice(sentRequestIndex, 1);
                this.showMessage(`${fromUserName} отклонил(а) вашу заявку в друзья`, 'warning');
            }
            
            this.saveToStorage();
            this.renderFriendsList();
            this.renderChatsList();
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

    joinTestChat() {
        // Общий тестовый чат с одинаковым ID на всех устройствах
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
        }

        this.openChat(chat.id);
        this.switchTab('chats');
        
        this.showMessage('Вы вошли в тестовый чат', 'success');
        
        // Отправляем тестовое сообщение
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

        // НОВОЕ: Кнопка заявок в друзья
        const requestsBtn = document.getElementById('requestsBtn');
        if (requestsBtn) {
            requestsBtn.addEventListener('click', () => {
                this.showFriendRequestsModal();
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
                this.sendFriendRequest();
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

        // НОВОЕ: Кнопка закрытия чата
        const closeChatBtn = document.querySelector('.close-chat-btn');
        if (closeChatBtn) {
            closeChatBtn.addEventListener('click', () => {
                this.closeCurrentChat();
            });
        }

        // НОВОЕ: Кнопка удаления чата
        const deleteChatBtn = document.querySelector('.delete-chat-btn');
        if (deleteChatBtn) {
            deleteChatBtn.addEventListener('click', () => {
                this.showDeleteChatModal();
            });
        }

        // НОВОЕ: Кнопки в модальном окне удаления
        const deleteCancelBtn = document.querySelector('.delete-cancel-btn');
        if (deleteCancelBtn) {
            deleteCancelBtn.addEventListener('click', () => {
                this.hideDeleteChatModal();
            });
        }

        const deleteConfirmBtn = document.querySelector('.delete-confirm-btn');
        if (deleteConfirmBtn) {
            deleteConfirmBtn.addEventListener('click', () => {
                this.deleteCurrentChat();
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

        // Тестовая кнопка
        const testBtn = document.getElementById('testBtn');
        if (testBtn) {
            testBtn.addEventListener('click', () => {
                this.joinTestChat();
            });
        }
    }

    // НОВЫЙ МЕТОД: Закрыть текущий чат
    closeCurrentChat() {
        if (!this.currentChat) {
            this.showMessage('Нет активного чата для закрытия', 'warning');
            return;
        }
        
        console.log('❌ Closing current chat:', this.currentChat.name);
        
        this.hideChat();
        this.showMessage(`Чат "${this.currentChat.name}" закрыт`, 'info');
    }

    // НОВЫЙ МЕТОД: Выйти из чата (удалить из списка)
    leaveChat(chatId, event = null) {
        if (event) {
            event.stopPropagation(); // Предотвращаем открытие чата
        }
        
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) {
            console.error('❌ Chat not found:', chatId);
            return;
        }
        
        // Если это текущий открытый чат, сначала закрываем его
        if (this.currentChat && this.currentChat.id === chatId) {
            this.hideChat();
        }
        
        console.log('🚪 Leaving chat:', chat.name);
        
        // Находим элемент чата в DOM
        const chatItem = document.querySelector(`.chat-item[onclick*="${chatId}"]`);
        if (chatItem) {
            // Добавляем класс для анимации
            chatItem.classList.add('closing');
            
            // Ждем завершения анимации перед удалением
            setTimeout(() => {
                // Удаляем чат из списка
                this.chats = this.chats.filter(c => c.id !== chatId);
                
                // Не удаляем сообщения, чтобы можно было вернуться
                // Но помечаем чат как скрытый для текущего пользователя
                if (!chat.hidden) {
                    chat.hidden = true;
                }
                
                this.saveToStorage();
                this.renderChatsList();
                
                this.showMessage(`Вы вышли из чата "${chat.name}"`, 'success');
                console.log('✅ Chat left successfully:', chat.name);
            }, 400);
        } else {
            // Если не нашли элемент DOM, просто удаляем
            this.chats = this.chats.filter(c => c.id !== chatId);
            
            if (!chat.hidden) {
                chat.hidden = true;
            }
            
            this.saveToStorage();
            this.renderChatsList();
            this.showMessage(`Вы вышли из чата "${chat.name}"`, 'success');
        }
    }

    // НОВЫЙ МЕТОД: Показать модальное окно удаления чата
    showDeleteChatModal() {
        if (!this.currentChat) {
            this.showMessage('Выберите чат для удаления', 'warning');
            return;
        }
        
        console.log('🗑️ Showing delete chat modal for:', this.currentChat.name);
        
        const modal = document.getElementById('deleteChatModal');
        const chatNameElement = document.getElementById('deleteChatName');
        
        if (modal && chatNameElement) {
            this.chatToDelete = this.currentChat;
            chatNameElement.textContent = this.currentChat.name;
            modal.style.display = 'flex';
        }
    }

    // НОВЫЙ МЕТОД: Скрыть модальное окно удаления
    hideDeleteChatModal() {
        const modal = document.getElementById('deleteChatModal');
        if (modal) {
            modal.style.display = 'none';
            this.chatToDelete = null;
        }
    }

    // НОВЫЙ МЕТОД: Удалить текущий чат
    deleteCurrentChat() {
        if (!this.chatToDelete) {
            console.error('❌ No chat selected for deletion');
            return;
        }
        
        console.log('🗑️ Deleting chat:', this.chatToDelete.name);
        
        const chatId = this.chatToDelete.id;
        const chatName = this.chatToDelete.name;
        
        // Находим элемент чата в DOM
        const chatItem = document.querySelector(`.chat-item[onclick*="${chatId}"]`);
        if (chatItem) {
            // Добавляем класс для анимации
            chatItem.classList.add('deleting');
            
            // Ждем завершения анимации перед удалением
            setTimeout(() => {
                // Удаляем из списка чатов
                this.chats = this.chats.filter(chat => chat.id !== chatId);
                
                // Удаляем сообщения
                this.messages.delete(chatId);
                
                // Если это текущий открытый чат - закрываем его
                if (this.currentChat && this.currentChat.id === chatId) {
                    this.currentChat = null;
                    this.hideChat();
                    
                    // Отписываемся от канала Ably
                    if (this.channel) {
                        this.channel.unsubscribe();
                        this.channel = null;
                    }
                }
                
                // Сохраняем изменения
                this.saveToStorage();
                
                // Обновляем интерфейс
                this.renderChatsList();
                
                // Закрываем модальное окно
                this.hideDeleteChatModal();
                
                // Показываем уведомление
                this.showMessage(`Чат "${chatName}" удален`, 'success');
                console.log('✅ Chat deleted successfully:', chatName);
            }, 400);
        } else {
            // Если не нашли элемент DOM, просто удаляем
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

        // ВАЖНО: Используем одинаковый ID для всех устройств
        const chatId = 'chat_' + chatName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        
        // Проверяем, нет ли уже такого чата
        let chat = this.chats.find(c => c.id === chatId);
        
        if (!chat) {
            chat = {
                id: chatId, // Используем одинаковый ID
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
        }

        this.hideNewChatModal();
        this.openChat(chat.id);
        
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

    async sendFriendRequest() {
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
        const requestId = 'request_' + Date.now();
        
        // Добавляем в отправленные заявки
        this.sentRequests.push({
            id: requestId,
            toUserName: friendName,
            timestamp: new Date().toISOString(),
            status: 'pending'
        });

        // Сохраняем
        this.saveToStorage();
        this.hideAddFriendModal();
        
        // Отправляем уведомление через Ably
        // В реальном приложении здесь нужно было бы найти ID пользователя по имени
        // Для демо мы будем использовать фиктивный канал
        try {
            // Предполагаем, что пользователь с таким именем существует
            // Используем имя как ID для демонстрации
            const userChannel = this.ably.channels.get(`user:${friendName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`);
            
            await userChannel.publish('friend_request', {
                fromUserId: this.currentUser.id,
                fromUserName: this.currentUser.fullName,
                requestId: requestId,
                timestamp: new Date().toISOString()
            });
            
            this.showMessage(`Заявка отправлена пользователю ${friendName}`, 'success');
            console.log('✅ Friend request sent to:', friendName);
            
        } catch (error) {
            console.error('❌ Error sending friend request:', error);
            // В демо-режиме все равно показываем успех
            this.showMessage(`Заявка отправлена пользователю ${friendName}. В демо-режиме пользователь может принять заявку позже.`, 'success');
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
        const activeTab = document.querySelector('.tab-content.active').id;
        
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

    showFriendRequestsModal() {
        console.log('📋 Showing friend requests modal');
        const modal = document.getElementById('friendRequestsModal');
        if (modal) {
            modal.style.display = 'flex';
            this.renderFriendRequests();
        }
    }

    updateRequestsBadge() {
        const badge = document.getElementById('requestsBadge');
        if (badge) {
            if (this.friendRequests.length > 0) {
                badge.textContent = this.friendRequests.length;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    async acceptFriendRequest(requestId) {
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
        
        // Отправляем ответ пользователю
        try {
            const userChannel = this.ably.channels.get(`user:${request.fromUserId}`);
            
            await userChannel.publish('friend_request_response', {
                requestId: requestId,
                accepted: true,
                fromUserId: this.currentUser.id,
                fromUserName: this.currentUser.fullName,
                timestamp: new Date().toISOString()
            });
            
            this.showMessage(`Вы приняли заявку от ${request.fromUserName}`, 'success');
            
            // Автоматически создаем чат с новым другом
            this.createFriendChat(request.fromUserId, request.fromUserName);
            
        } catch (error) {
            console.error('❌ Error sending acceptance:', error);
            this.showMessage('Заявка принята, но не удалось уведомить пользователя', 'warning');
        }
    }

    async rejectFriendRequest(requestId) {
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
        
        // Отправляем ответ пользователю
        try {
            const userChannel = this.ably.channels.get(`user:${request.fromUserId}`);
            
            await userChannel.publish('friend_request_response', {
                requestId: requestId,
                accepted: false,
                fromUserId: this.currentUser.id,
                fromUserName: this.currentUser.fullName,
                timestamp: new Date().toISOString()
            });
            
            this.showMessage(`Вы отклонили заявку от ${request.fromUserName}`, 'info');
            
        } catch (error) {
            console.error('❌ Error sending rejection:', error);
            this.showMessage('Заявка отклонена, но не удалось уведомить пользователя', 'warning');
        }
    }

    createFriendChat(friendId, friendName) {
        const chatId = 'friend_chat_' + friendId;
        
        // Проверяем, нет ли уже такого чата
        let chat = this.chats.find(c => c.id === chatId);
        
        if (!chat) {
            console.log('🆕 Creating chat with new friend:', friendName);
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
        this.chatToDelete = null;
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
        
        // Обновляем бейдж заявок
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

        // Фильтруем скрытые чаты
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
        console.log('💬 Starting chat with friend:', friendId);
        const friend = this.friends.find(f => f.id === friendId);
        if (!friend) {
            console.error('❌ Friend not found:', friendId);
            this.showMessage('Друг не найден', 'error');
            return;
        }

        // ВАЖНО: Используем одинаковый ID для чата с другом
        const chatId = 'friend_chat_' + friendId;
        
        let chat = this.chats.find(c => c.id === chatId);
        
        if (!chat) {
            console.log('🆕 Creating new chat with friend:', friend.name);
            chat = {
                id: chatId, // Используем одинаковый ID
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
                messages: Array.from(this.messages.entries()),
                friendRequests: this.friendRequests,
                sentRequests: this.sentRequests
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
                
                // Загружаем заявки
                this.friendRequests = data.friendRequests || [];
                this.sentRequests = data.sentRequests || [];
                
                // Обновляем бейдж заявок
                this.updateRequestsBadge();
                
                console.log('✅ Data loaded from storage');
            } catch (e) {
                console.error('❌ Error loading data:', e);
                this.chats = [];
                this.friends = [];
                this.friendRequests = [];
                this.sentRequests = [];
                this.usedNames = new Set(['Пользователь']);
                this.messages = new Map();
            }
        } else {
            console.log('📝 No data found in storage');
            this.chats = [];
            this.friends = [];
            this.friendRequests = [];
            this.sentRequests = [];
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
console.log('🚀 Starting Rurum Messenger with chat deletion feature...');
const messenger = new RurumMessenger();
window.messenger = messenger;

// Глобальные функции для отладки
window.debugData = () => {
    console.log('🐛 DEBUG DATA:');
    console.log('Chats:', messenger.chats);
    console.log('Friends:', messenger.friends);
    console.log('Current Chat:', messenger.currentChat);
    console.log('User:', messenger.currentUser);
    console.log('Used Names:', Array.from(messenger.usedNames));
    console.log('Messages:', Array.from(messenger.messages.entries()));
    console.log('Friend Requests:', messenger.friendRequests || []);
    console.log('Sent Requests:', messenger.sentRequests || []);
    console.log('Ably connected:', messenger.ably ? messenger.ably.connection.state : 'No');
};

window.testAbly = () => {
    if (messenger.ably) {
        console.log('🔧 Ably connection state:', messenger.ably.connection.state);
        console.log('🔧 Ably channel:', messenger.channel ? messenger.channel.name : 'No channel');
    } else {
        console.log('❌ Ably not initialized');
    }
};

window.clearData = () => {
    if (confirm('Очистить все данные?')) {
        localStorage.clear();
        location.reload();
    }
};

window.joinTest = () => {
    messenger.joinTestChat();
};

window.leaveChat = (chatId) => {
    messenger.leaveChat(chatId);
};

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