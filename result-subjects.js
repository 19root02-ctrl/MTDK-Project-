(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.resultSubjectMapping = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const SUBJECT_GROUPS = {
        PRIMARY: [
            { field: 'marathi', apiKey: 'marathi', label: 'Marathi', maxMarks: 40 },
            { field: 'english', apiKey: 'english', label: 'English', maxMarks: 40 },
            { field: 'maths', apiKey: 'maths', label: 'Maths', maxMarks: 40 },
            { field: 'evs', apiKey: 'evs', label: 'EVS', maxMarks: 40 },
            { field: 'logicalReasoning', apiKey: 'logicalReasoning', label: 'Logical Reasoning', maxMarks: 40 }
        ],
        SECONDARY: [
            { field: 'marathi', apiKey: 'marathi', label: 'Marathi', maxMarks: 30 },
            { field: 'english', apiKey: 'english', label: 'English', maxMarks: 30 },
            { field: 'maths', apiKey: 'maths', label: 'Maths', maxMarks: 30 },
            { field: 'evsScience', apiKey: 'evsScience', label: 'EVS / Science', maxMarks: 30 },
            { field: 'socialScience', apiKey: 'socialScience', label: 'Social Science', maxMarks: 30 },
            { field: 'logicalReasoning', apiKey: 'logicalReasoning', label: 'Logical Reasoning', maxMarks: 50 }
        ]
    };

    function normalizeResultHeader(value = '') {
        const compact = String(value || '')
            .replace(/\uFEFF/g, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');

        const aliases = {
            marathi: 'marathi',
            english: 'english',
            maths: 'maths',
            mathematics: 'maths',
            evs: 'evs',
            science: 'evsScience',
            evsscience: 'evsScience',
            socialscience: 'socialScience',
            socialsciences: 'socialScience',
            logicalreasoning: 'logicalReasoning',
            registrationno: 'registration_no',
            registrationnumber: 'registration_no',
            regno: 'registration_no',
            regnumber: 'registration_no',
            schoolname: 'school_name'
        };

        return aliases[compact] || String(value || '')
            .replace(/\uFEFF/g, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .replace(/_+/g, '_');
    }

    function getGroupForClass(classValue = '') {
        const normalized = String(classValue || '').trim().toUpperCase();
        const romanClasses = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
        const numericMatch = normalized.match(/(?:CLASS\s*)?(10|[1-9])(?:ST|ND|RD|TH)?/);
        const classNumber = numericMatch ? Number(numericMatch[1]) : romanClasses[normalized] || null;
        return classNumber !== null && classNumber <= 4 ? 'PRIMARY' : 'SECONDARY';
    }

    return { SUBJECT_GROUPS, normalizeResultHeader, getGroupForClass };
}));
