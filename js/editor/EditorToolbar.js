/**
 * ============================================
 * EditorToolbar.js
 * Панель инструментов (MVP)
 * ============================================
 */

class EditorToolbar {
    constructor(options = {}) {
        this.currentTool = 'select';
        
        this.onChange = options.onChange || (() => {});
        
        this._createToolbar();
        
        console.log('[EditorToolbar] Создан');
    }
    
    _createToolbar() {
        this.element = document.createElement('div');
        this.element.id = 'editor-toolbar';
        this.element.className = 'editor-toolbar';
        this.element.innerHTML = `
            <button class="tool-btn active" data-tool="select" title="Выбор (V)">
                <span class="tool-icon">↖</span>
                <span class="tool-label">Выбор</span>
            </button>
            <button class="tool-btn" data-tool="draw" title="Рисовать (D)">
                <span class="tool-icon">✏</span>
                <span class="tool-label">Рисовать</span>
            </button>
            <div class="tool-separator"></div>
            <button class="tool-btn danger" data-tool="delete" title="Удалить (Del)">
                <span class="tool-icon">🗑</span>
                <span class="tool-label">Удалить</span>
            </button>
        `;
        
        document.getElementById('scene-mode').appendChild(this.element);
        
        // Обработчики
        this.element.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setTool(btn.dataset.tool);
            });
        });
        
        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            
            switch(e.key.toLowerCase()) {
                case 'v': this.setTool('select'); break;
                case 'd': this.setTool('draw'); break;
                case 'delete': this.setTool('delete'); break;
                case 'escape': this.setTool('select'); break;
            }
        });
    }
    
    setTool(tool) {
        if (tool === 'delete') {
            this.onChange('delete', this.currentTool);
            return;
        }
        
        const prevTool = this.currentTool;
        this.currentTool = tool;
        
        this.element.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        
        this.onChange(tool, prevTool);
        
        console.log(`[EditorToolbar] Инструмент: ${tool}`);
    }
    
    getTool() {
        return this.currentTool;
    }
    
    show() {
        this.element.classList.remove('hidden');
    }
    
    hide() {
        this.element.classList.add('hidden');
    }
}

export { EditorToolbar };
window.EditorToolbar = EditorToolbar;