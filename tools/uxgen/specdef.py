# -*- coding: utf-8 -*-
class E:
    def __init__(self, id, name, folder, type, level, parent, concept, component, milestone, summary,
                 up=(), down=(), api=(), store=(), states=(), rules=(), accept=(), gaps=()):
        self.id, self.name, self.folder, self.type, self.level = id, name, folder, type, level
        self.parent, self.concept, self.component, self.milestone, self.summary = parent, list(concept), component, milestone, summary
        self.up, self.down, self.api, self.store = list(up), list(down), list(api), list(store)
        self.states, self.rules, self.accept, self.gaps = list(states), list(rules), list(accept), list(gaps)
