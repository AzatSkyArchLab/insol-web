/**
 * ============================================
 * BuildingCardController.js
 * Управление карточкой информации о здании
 * ============================================
 */

class BuildingCardController {
    /**
     * @param {App} app - главный класс приложения
     */
    constructor(app) {
        this.app = app;
        this.state = app.state;
        this.bus = app.bus;
        
        this._bindEvents();
        this._bindBusEvents();
        
        console.log('[BuildingCardController] Создан');
    }
    
    /**
     * Привязка DOM-событий
     */
    _bindEvents() {
        document.getElementById('card-close')
            .addEventListener('click', () => this.close());
        
        document.getElementById('edit-height-btn')
            .addEventListener('click', () => this.onEditHeightClick());
        
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.onToggleBuildingType(e));
        });
    }
    
    /**
     * Привязка событий шины
     */
    _bindBusEvents() {
        this.bus.on('building:selected', ({ data, mesh }) => {
            this.show(data);
        });
        
        this.bus.on('building:multiselect', ({ meshes }) => {
            this.showMultiSelect(meshes);
        });
        
        this.bus.on('building:deselected', () => {
            this.close();
        });
        
        this.bus.on('building:changed', ({ mesh, changeType, height }) => {
            if (changeType === 'height' || changeType === 'height-complete') {
                this._updateHeightDisplay(height);
            }
        });
    }
    
    /**
     * Показать карточку здания
     * @param {Object} data - userData меша
     */
    show(data) {
        const card = document.getElementById('building-card');
        
        if (!data) {
            card.classList.add('hidden');
            return;
        }
        
        const props = data.properties || {};
        
        card.className = props.isResidential ? 'residential' : 'other';
        
        document.getElementById('card-title').textContent = 
            props.isResidential ? 'Жилое здание' : 'Здание';
        
        // Кнопки типа
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            const btnResidential = btn.dataset.residential === 'true';
            btn.classList.remove('active', 'residential', 'other');
            if (btnResidential === props.isResidential) {
                btn.classList.add('active', props.isResidential ? 'residential' : 'other');
            }
        });
        
        // Информация
        document.getElementById('card-function').textContent = 
            this._formatBuildingType(props.buildingType);
        document.getElementById('card-levels').textContent = 
            props.levels ? props.levels : '—';
        document.getElementById('card-height').textContent = 
            props.height ? `${props.height.toFixed(1)} м` : '—';
        document.getElementById('card-height-source').textContent = 
            this._formatHeightSource(props.heightSource);
        document.getElementById('card-address').textContent = 
            props.address || '—';
        document.getElementById('card-osm-id').textContent = 
            data.id || '—';
        
        card.classList.remove('hidden');
        
        // Показываем элементы для одиночного выбора
        document.querySelectorAll('.single-select-only').forEach(el => {
            el.style.display = '';
        });
        
        const multiInfo = document.getElementById('multi-select-info');
        if (multiInfo) multiInfo.style.display = 'none';
    }
    
    /**
     * Показать карточку для множественного выбора
     * @param {Array} meshes - массив выбранных мешей
     */
    showMultiSelect(meshes) {
        const card = document.getElementById('building-card');
        
        if (!meshes || meshes.length === 0) {
            card.classList.add('hidden');
            return;
        }
        
        // Если выбран один - показываем обычную карточку
        if (meshes.length === 1) {
            this.show(meshes[0].userData);
            return;
        }
        
        const residentialCount = meshes.filter(m => 
            m.userData.properties?.isResidential
        ).length;
        
        card.className = 'multi-select';
        document.getElementById('card-title').textContent = 
            `Выбрано: ${meshes.length} зданий`;
        
        // Скрываем элементы одиночного выбора
        document.querySelectorAll('.single-select-only').forEach(el => {
            el.style.display = 'none';
        });
        
        // Показываем/создаём блок множественного выбора
        let multiInfo = document.getElementById('multi-select-info');
        if (!multiInfo) {
            multiInfo = document.createElement('div');
            multiInfo.id = 'multi-select-info';
            multiInfo.className = 'info-grid';
            const cardContent = card.querySelector('.card-content') || card;
            const infoGrid = card.querySelector('.info-grid');
            if (infoGrid) {
                infoGrid.parentNode.insertBefore(multiInfo, infoGrid);
            } else {
                cardContent.appendChild(multiInfo);
            }
        }
        
        multiInfo.innerHTML = `
            <div class="info-row">
                <span class="info-label">Жилых:</span>
                <span class="info-value">${residentialCount}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Других:</span>
                <span class="info-value">${meshes.length - residentialCount}</span>
            </div>
        `;
        multiInfo.style.display = '';
        
        card.classList.remove('hidden');
    }
    
    /**
     * Закрыть карточку
     */
    close() {
        document.getElementById('building-card').classList.add('hidden');
        
        const { state } = this;
        
        if (state.heightEditor?.isActive()) {
            state.heightEditor.deactivate();
        }
        
        if (state.selectTool) {
            state.selectTool.deselect();
        }
    }
    
    /**
     * Клик по кнопке редактирования высоты
     */
    onEditHeightClick() {
        const { state } = this;
        
        if (!state.selectTool || !state.heightEditor) return;
        
        const selectedMesh = state.selectTool.getSelected();
        if (selectedMesh) {
            state.heightEditor.activate(selectedMesh);
        }
    }
    
    /**
     * Переключение типа здания (жилое/нежилое)
     */
    onToggleBuildingType(event) {
        const { state, bus } = this;
        
        if (!state.selectTool) return;
        
        const selectedMesh = state.selectTool.getSelected();
        if (!selectedMesh) return;
        
        const isResidential = event.target.dataset.residential === 'true';
        
        selectedMesh.userData.properties.isResidential = isResidential;
        
        const newColor = isResidential ? 0x5b8dd9 : 0x888888;
        selectedMesh.material.color.setHex(newColor);
        selectedMesh.userData.originalColor = newColor;
        
        // Обновляем кнопки
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.classList.remove('active', 'residential', 'other');
        });
        event.target.classList.add('active', isResidential ? 'residential' : 'other');
        
        // Обновляем карточку
        const card = document.getElementById('building-card');
        card.className = isResidential ? 'residential' : 'other';
        document.getElementById('card-title').textContent = 
            isResidential ? 'Жилое здание' : 'Здание';
        
        bus.emit('building:changed', { 
            mesh: selectedMesh, 
            changeType: 'type',
            isResidential 
        });
    }
    
    // ============================================
    // Private helpers
    // ============================================
    
    _updateHeightDisplay(height) {
        document.getElementById('card-height').textContent = `${height} м`;
        document.getElementById('card-height-source').textContent = 'Редактирование';
    }
    
    _formatBuildingType(type) {
        const types = {
            'apartments': 'Многоквартирный дом',
            'residential': 'Жилой дом',
            'house': 'Дом',
            'detached': 'Отдельный дом',
            'dormitory': 'Общежитие',
            'commercial': 'Коммерческое',
            'retail': 'Торговое',
            'office': 'Офисное',
            'industrial': 'Промышленное',
            'warehouse': 'Склад',
            'school': 'Школа',
            'university': 'Университет',
            'hospital': 'Больница',
            'church': 'Церковь',
            'garage': 'Гараж',
            'garages': 'Гаражи',
            'shed': 'Сарай',
            'roof': 'Навес',
            'yes': 'Не указано'
        };
        return types[type] || type || 'Не указано';
    }
    
    _formatHeightSource(source) {
        const sources = {
            'osm': 'OSM (точная)',
            'levels': 'Из этажей',
            'edited': 'Редактирование',
            'default': 'По умолчанию'
        };
        return sources[source] || 'По умолчанию';
    }
}

export { BuildingCardController };
