 // ==================== INITIALIZATION ====================
function initApp() {
    // Initialize Lucide Icons
    try { lucide.createIcons(); } catch (e) {}

    populateAdminCategoryOptions();
    renderAdminStudents();
    renderAdminResources();
    renderStudentResources();
    showAdminPanel("students");
    toggleResourceInputMode();
    loadStudentsFromDatabase();
    loadResourcesFromDatabase();
    
    // Set initial date defaults
    const today = new Date();
    // Default DOB to 10 years ago for typical student profile
    const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
    const dobInput = document.getElementById("dateOfBirth");
    if (dobInput) {
        dobInput.value = tenYearsAgo.toISOString().split('T')[0];
    }

    // Attach payment screenshot change handler
    // Default fee calculation
    try { updateDynamicFee(); } catch (e) {}

    // Check URL hashes for routing
    const hash = window.location.hash.replace("#", "");
    if (hash && ["home", "about", "exam", "admin", "login"].includes(hash)) {
        switchTab(hash);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", initApp);
} else {
    initApp();
}

const adminCategories = [
    { value: "std-i-ii", label: "Std I-II" },
    { value: "std-iii-iv", label: "Std III-IV" },
    { value: "std-v-vi", label: "Std V-VI" },
    { value: "std-vii-viii", label: "Std VII-VIII" },
    { value: "std-ix-x", label: "Std IX-X" }
];

// Initialize database from localStorage or default values
const defaultStudent = {
    fullName: "RAHUL RAMESH SHINDE",
    class: "VII",
    medium: "English",
    schoolName: "MATOSHREE ENGLISH SCHOOL, MIRAJ",
    dob: "2014-08-15",
    parentName: "RAMESH SHINDE",
    whatsapp: "9876543210",
    address: "Plot No 4, Shivaji Nagar, Taluka Miraj, District Sangli - 416410",
    amount: "₹550.00",
    payMode: "UPI (Verified)",
    regNo: "IMTSE-10984",
    status: "Approved & Active (Fees Paid)",
    regDate: "15-July-2026"
};

let dbStudents = [];
let dbResources = [];
let adminSession = false;
const API_BASE_URL = window.location.origin;
try {
    const savedStudents = localStorage.getItem("imtse_students");
    if (savedStudents) {
        dbStudents = JSON.parse(savedStudents);
    }
    const savedResources = localStorage.getItem("imtse_resources");
    if (savedResources) {
        dbResources = JSON.parse(savedResources);
    }
} catch (e) {
    console.error("Failed to load local storage", e);
}

if (dbStudents.length === 0) {
    dbStudents = [defaultStudent];
}

if (dbResources.length === 0) {
    dbResources = [
        {
            id: 1,
            title: "Math Practice Sheet",
            category: "std-i-ii",
            type: "PDF",
            url: "https://example.com/math-practice.pdf",
            description: "Practice worksheets for early learners"
        },
        {
            id: 2,
            title: "Science Revision Notes",
            category: "std-vii-viii",
            type: "DOC",
            url: "https://example.com/science-notes.docx",
            description: "Revision notes for middle school"
        }
    ];
}

const mockDatabase = {
    get students() {
        return dbStudents;
    },
    save(newStudent) {
        dbStudents.push(newStudent);
        try {
            localStorage.setItem("imtse_students", JSON.stringify(dbStudents));
        } catch (e) {
            console.error("Failed to save to local storage", e);
        }
    },
    saveResource(resource) {
        dbResources.push(resource);
        try {
            localStorage.setItem("imtse_resources", JSON.stringify(dbResources));
        } catch (e) {
            console.error("Failed to save resources to local storage", e);
        }
    },
    updateResource(updatedResource) {
        dbResources = dbResources.map(resource => resource.id === updatedResource.id ? updatedResource : resource);
        try {
            localStorage.setItem("imtse_resources", JSON.stringify(dbResources));
        } catch (e) {
            console.error("Failed to update resources in local storage", e);
        }
    },
    deleteResource(resourceId) {
        dbResources = dbResources.filter(resource => resource.id !== resourceId);
        try {
            localStorage.setItem("imtse_resources", JSON.stringify(dbResources));
        } catch (e) {
            console.error("Failed to delete resources from local storage", e);
        }
    },
    updateStudent(updatedStudent) {
        dbStudents = dbStudents.map(student => student.regNo === updatedStudent.regNo ? updatedStudent : student);
        try {
            localStorage.setItem("imtse_students", JSON.stringify(dbStudents));
        } catch (e) {
            console.error("Failed to update student in local storage", e);
        }
    },
    deleteStudent(regNo) {
        dbStudents = dbStudents.filter(student => student.regNo !== regNo);
        try {
            localStorage.setItem("imtse_students", JSON.stringify(dbStudents));
        } catch (e) {
            console.error("Failed to delete student from local storage", e);
        }
    }
};

async function loadStudentsFromDatabase() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/students`);
        if (!response.ok) {
            throw new Error(`Student fetch failed with status ${response.status}`);
        }
        const students = await response.json();
        dbStudents = (students || []).map(student => ({
            ...student,
            fullName: student.full_name || student.fullName,
            class: student.student_class || student.class,
            schoolName: student.school_name || student.schoolName,
            parentName: student.parent_name || student.parentName,
            whatsapp: student.whatsapp,
            payMode: student.pay_mode || student.payMode,
            regNo: student.reg_no || student.regNo,
            regDate: student.reg_date || student.regDate
        }));
        renderAdminStudents();
    } catch (error) {
        console.error("Failed to load students from database", error);
    }
}

async function saveStudentToDatabase(studentData, existingRegNo = null) {
    const endpoint = existingRegNo ? `${API_BASE_URL}/api/students/${encodeURIComponent(existingRegNo)}` : `${API_BASE_URL}/api/students`;
    const method = existingRegNo ? "PUT" : "POST";
    const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(studentData)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Student save failed with status ${response.status}`);
    }
    return response.json();
}

async function deleteStudentFromDatabase(regNo) {
    const response = await fetch(`${API_BASE_URL}/api/students/${encodeURIComponent(regNo)}`, { method: "DELETE" });
    if (!response.ok) {
        throw new Error(`Student deletion failed with status ${response.status}`);
    }
    return response.json();
}

async function loadResourcesFromDatabase() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/resources`);
        if (!response.ok) {
            throw new Error(`Resource fetch failed with status ${response.status}`);
        }
        const resources = await response.json();
        if (Array.isArray(resources) && resources.length > 0) {
            dbResources = resources;
            try {
                localStorage.setItem("imtse_resources", JSON.stringify(dbResources));
            } catch (e) {
                console.error("Failed to sync resources to local storage", e);
            }
        }
        renderAdminResources();
        renderStudentResources();
    } catch (error) {
        console.error("Failed to load resources from database", error);
    }
}

async function saveResourceToDatabase(resourceData, existingId = null) {
    const endpoint = existingId ? `${API_BASE_URL}/api/resources/${encodeURIComponent(existingId)}` : `${API_BASE_URL}/api/resources`;
    const method = existingId ? "PUT" : "POST";
    const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resourceData)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Resource save failed with status ${response.status}`);
    }
    return response.json();
}

async function deleteResourceFromDatabase(resourceId) {
    const response = await fetch(`${API_BASE_URL}/api/resources/${encodeURIComponent(resourceId)}`, { method: "DELETE" });
    if (!response.ok) {
        throw new Error(`Resource deletion failed with status ${response.status}`);
    }
    return response.json();
}

// State Variables
let currentStep = 1;
let selectedPaymentMode = "";
let isPaymentApproved = false;
let upiTimerInterval = null;
let activeStudentSession = null;
let whatsappAvailable = true;

function setWhatsappError(message) {
    const whatsappInput = document.getElementById("whatsappNumber");
    const whatsappError = document.getElementById("whatsappError");
    if (!whatsappInput || !whatsappError) return;

    if (message) {
        whatsappInput.classList.add("invalid");
        whatsappError.innerText = message;
        whatsappError.classList.add("active");
    } else {
        whatsappInput.classList.remove("invalid");
        whatsappError.innerText = "";
        whatsappError.classList.remove("active");
    }
}

async function ensureWhatsappAvailable() {
    const whatsappInput = document.getElementById("whatsappNumber");
    if (!whatsappInput) return true;

    const val = whatsappInput.value.trim();
    if (!/^\d{10}$/.test(val)) {
        whatsappAvailable = false;
        setWhatsappError("Please enter a valid 10-digit mobile number.");
        return false;
    }

    const localExists = dbStudents.some((student) => String(student.whatsapp || "").trim() === val);
    if (localExists) {
        whatsappAvailable = false;
        setWhatsappError("Mobile number is already registered.");
        return false;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/students/${encodeURIComponent(val)}`);
        if (response.status === 404) {
            whatsappAvailable = true;
            setWhatsappError("");
            return true;
        }

        if (response.ok) {
            const student = await response.json();
            if (student && (student.whatsapp || student.reg_no || student.regNo)) {
                whatsappAvailable = false;
                setWhatsappError("Mobile number is already registered.");
                return false;
            }
        }

        whatsappAvailable = true;
        setWhatsappError("");
        return true;
    } catch (error) {
        console.warn("Server mobile check warning:", error);
        whatsappAvailable = !localExists;
        if (!whatsappAvailable) {
            setWhatsappError("Mobile number is already registered.");
        } else {
            setWhatsappError("");
        }
        return whatsappAvailable;
    }
}

// ==================== SPA NAVIGATION & ROUTING ====================
function switchTab(tabId) {
    // Hide all views
    const views = document.querySelectorAll(".tab-view");
    views.forEach(view => view.classList.remove("active"));

    // Show selected view
    const targetView = document.getElementById(`${tabId}-view`);
    if (targetView) {
        targetView.classList.add("active");
    }

    // Update active nav links
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach(link => {
        if (link.getAttribute("href") === `#${tabId}`) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // Close mobile menu if active
    const navMenu = document.getElementById("navMenu");
    if (navMenu) {
        navMenu.classList.remove("mobile-active");
    }
    const menuIcon = document.getElementById("menuIcon");
    if (menuIcon) {
        menuIcon.setAttribute("data-lucide", "menu");
        lucide.createIcons();
    }

    // Trigger specific dashboard calculations if entering login/dashboard view
    if (tabId === "login" && activeStudentSession) {
        showDashboardView(activeStudentSession);
    } else if (tabId === "login" && !activeStudentSession) {
        document.getElementById("login-form-box").classList.remove("hidden");
        document.getElementById("student-dashboard").classList.add("hidden");
    }

    // Smooth scroll to top of page
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToSection(sectionId) {
    setTimeout(() => {
        const element = document.getElementById(sectionId);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, 100);
}

function toggleMobileMenu() {
    const navMenu = document.getElementById("navMenu");
    const menuIcon = document.getElementById("menuIcon");
    
    if (navMenu.classList.contains("mobile-active")) {
        navMenu.classList.remove("mobile-active");
        menuIcon.setAttribute("data-lucide", "menu");
    } else {
        navMenu.classList.add("mobile-active");
        menuIcon.setAttribute("data-lucide", "x");
    }
    lucide.createIcons();
}

// Ensure these functions are available on the global `window` for inline handlers
try {
    if (typeof window !== 'undefined') {
        window.switchTab = switchTab;
        window.scrollToSection = scrollToSection;
        window.toggleMobileMenu = toggleMobileMenu;
        window.handleLoginSubmit = handleLoginSubmit;
        window.loginDirectlyFromReceipt = loginDirectlyFromReceipt;
        window.downloadHallTicket = downloadHallTicket;
        window.handleDashboardLogout = handleDashboardLogout;
        window.showDashboardView = showDashboardView;
    }
} catch (e) { /* ignore */ }

// Drain any queued navigation/scroll requests made before app loaded
try {
    if (window._navQueue && window._navQueue.length) {
        window._navQueue.forEach(t => { try { if (typeof switchTab === 'function') switchTab(t); } catch (e) {} });
        window._navQueue = [];
    }
    if (window._scrollQueue && window._scrollQueue.length) {
        window._scrollQueue.forEach(s => { try { if (typeof scrollToSection === 'function') scrollToSection(s); } catch (e) {} });
        window._scrollQueue = [];
    }
    window._realSwitchTab = switchTab;
} catch (e) { /* ignore */ }



// ==================== REGISTRATION: RULES CHECK ====================
function toggleFormLock() {
    const rulesCheckbox = document.getElementById("rulesCheckbox");
    const formWrapper = document.getElementById("registration-section");
    
    if (rulesCheckbox.checked) {
        formWrapper.classList.remove("locked");
        scrollToSection("registration-section");
    } else {
        formWrapper.classList.add("locked");
    }
}

// ==================== REGISTRATION: FORM WIZARD ====================
async function nextStep(step) {
    if (currentStep === 1 && step === 2) {
        const ok = await ensureWhatsappAvailable();
        if (!ok) return;
    }

    if (validateStep(currentStep)) {
        // Mark indicator completed
        document.getElementById(`step${currentStep}-indicator`).classList.add("completed");
        document.getElementById(`step${currentStep}-indicator`).classList.remove("active");
        
        currentStep = step;
        
        // Show next view
        showStepContent(currentStep);
    }
}

function prevStep(step) {
    document.getElementById(`step${currentStep}-indicator`).classList.remove("active");
    
    currentStep = step;
    
    document.getElementById(`step${currentStep}-indicator`).classList.remove("completed");
    document.getElementById(`step${currentStep}-indicator`).classList.add("active");
    
    showStepContent(currentStep);
}

function showStepContent(step) {
    // Hide all step content wrappers
    const steps = document.querySelectorAll(".form-step-content");
    steps.forEach(s => s.classList.remove("active"));
    
    // Show active step
    document.getElementById(`form-step-${step}`).classList.add("active");
    document.getElementById(`step${step}-indicator`).classList.add("active");
    
    lucide.createIcons();
    scrollToSection("registration-section");
}

function validateStep(step) {
    if (step === 1) {
        const name = document.getElementById("fullName").value.trim();
        const stdClass = document.getElementById("studentClass").value;
        const medium = document.querySelector('input[name="medium"]:checked');
        const school = document.getElementById("schoolName").value.trim();
        const dob = document.getElementById("dateOfBirth").value;
        const parent = document.getElementById("parentName").value.trim();
        const whatsapp = document.getElementById("whatsappNumber").value;

        if (!name || !stdClass || !medium || !school || !dob || !parent || !whatsapp) {
            alert("Please fill all student information fields marked with *");
            return false;
        }
        if (whatsapp.length !== 10 || isNaN(whatsapp)) {
            alert("Please enter a valid 10-digit Mobile Number.");
            return false;
        }
        if (!whatsappAvailable) {
            setWhatsappError("WhatsApp number is already registered.");
            return false;
        }
        return true;
    }
    
    if (step === 2) {
        const sAddr = document.getElementById("schoolAddressVal").value.trim();
        const sTal = document.getElementById("schoolTaluka").value.trim();
        const sDist = document.getElementById("schoolDistrict").value.trim();
        const sPin = document.getElementById("schoolPin").value;
        
        const rAddr = document.getElementById("resAddressVal").value.trim();
        const rTal = document.getElementById("resTaluka").value.trim();
        const rDist = document.getElementById("resDistrict").value.trim();
        const rPin = document.getElementById("resPin").value;

        if (!sAddr || !sTal || !sDist || !sPin || !rAddr || !rTal || !rDist || !rPin) {
            alert("Please enter school and residential address details completely.");
            return false;
        }
        if (sPin.length !== 6 || isNaN(sPin) || rPin.length !== 6 || isNaN(rPin)) {
            alert("PIN code must be a 6-digit number.");
            return false;
        }
        return true;
    }
    
    return true;
}

// Copy address fields logic
function copyAddressFields() {
    const checkBtn = document.getElementById("copyAddressBtn");
    
    if (checkBtn.checked) {
        document.getElementById("resAddressVal").value = document.getElementById("schoolAddressVal").value;
        document.getElementById("resTaluka").value = document.getElementById("schoolTaluka").value;
        document.getElementById("resDistrict").value = document.getElementById("schoolDistrict").value;
        document.getElementById("resPin").value = document.getElementById("schoolPin").value;
    } else {
        document.getElementById("resAddressVal").value = "";
        document.getElementById("resTaluka").value = "";
        document.getElementById("resDistrict").value = "";
        document.getElementById("resPin").value = "";
    }
}

// ==================== REGISTRATION: FEES & PAYMENT SIMULATION ====================
function updateDynamicFee() {
    const stdClass = document.getElementById("studentClass").value;
    let baseFee = 0;
    
    // Fee mapping based on standard
    if (["I", "II", "III", "IV"].includes(stdClass)) {
        baseFee = 450;
    } else if (["V", "VI"].includes(stdClass)) {
        baseFee = 500;
    } else if (["VII", "VIII"].includes(stdClass)) {
        baseFee = 550;
    } else if (["IX", "X"].includes(stdClass)) {
        baseFee = 600;
    }

    // Display calculations
    document.getElementById("baseFeeDisplay").innerText = `₹${baseFee}`;
    
    // Late fee logic.
    const today = new Date();
    const lateDeadline = new Date(2026, 9, 31); // 31 Oct 2026 (Month is 0-indexed)
    
    let isLate = today > lateDeadline;
    const lateFeeRow = document.getElementById("lateFeeRow");
    
    let totalFee = baseFee;
    if (isLate) {
        totalFee += 50;
        if (lateFeeRow) lateFeeRow.style.display = "flex";
    } else {
        if (lateFeeRow) lateFeeRow.style.display = "none";
    }

    document.getElementById("totalFeeDisplay").innerText = `₹${totalFee}`;
    
    // Payment mode values inside simulator descriptions
    document.getElementById("qrAmountDisplay").innerText = `₹${totalFee}`;
    document.getElementById("cashAmountDisplay").innerText = `₹${totalFee}`;
}

function handlePaymentModeChange(mode) {
    selectedPaymentMode = mode;
    isPaymentApproved = false;
    
    // Stop any running UPI simulator countdown timers
    clearInterval(upiTimerInterval);
    
    // Hide all simulators
    document.getElementById("upiPaymentSimulator").classList.add("hidden");
    document.getElementById("cashPaymentNotice").classList.add("hidden");
    
    // Show correct simulator
    if (mode === "UPI") {
        document.getElementById("upiPaymentSimulator").classList.remove("hidden");
        startUPITimer(300); // 5 minutes timer
    } else if (mode === "Cash") {
        document.getElementById("cashPaymentNotice").classList.remove("hidden");
        isPaymentApproved = true; // Offline doesn't require immediate cash clearance
    }
}

// UPI Timer Simulation
function startUPITimer(durationSeconds) {
    let timer = durationSeconds;
    const display = document.getElementById("timerText");
    
    upiTimerInterval = setInterval(() => {
        let minutes = parseInt(timer / 60, 10);
        let seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        display.textContent = minutes + ":" + seconds;

        if (--timer < 0) {
            clearInterval(upiTimerInterval);
            display.textContent = "EXPIRED";
            alert("UPI payment window expired. Please scan again.");
        }
    }, 1000);
}

function verifyUPISimulation() {
    clearInterval(upiTimerInterval);
    isPaymentApproved = true;
    alert("Simulated UPI payment verified successfully!");
    
    const qrText = document.getElementById("timerText");
    qrText.innerHTML = "<span style='color: var(--color-success)'>VERIFIED & APPROVED</span>";
}

// Helper: Read file as base64 string
// ==================== FORM SUBMISSION & RECEIPT GENERATOR ====================
async function handleFormSubmit(event) {
    event.preventDefault();
    
    if (!selectedPaymentMode) {
        alert("Please select a payment mode to complete registration.");
        return;
    }
    
    if (!isPaymentApproved) {
        alert("Please approve the payment transaction using the simulator options before submitting.");
        return;
    }

    // Set declaration check
    const declareCheck = document.getElementById("declarationCheckbox");
    if (!declareCheck.checked) {
        alert("You must declare that the information provided is correct.");
        return;
    }

    // Generate Mock Registration Number
    const regNum = "IMTSE-" + Math.floor(10000 + Math.random() * 90000);
    const today = new Date();
    const formattedDate = today.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric"
    });

    // Extract Form Values
    const nameVal = document.getElementById("fullName").value.toUpperCase();
    const schoolVal = document.getElementById("schoolName").value.toUpperCase();
    const classVal = document.getElementById("studentClass").value;
    const mediumVal = document.querySelector('input[name="medium"]:checked').value;
    const resAddr = document.getElementById("resAddressVal").value + ", Taluka " +
        document.getElementById("resTaluka").value + ", District " +
        document.getElementById("resDistrict").value + " - " +
        document.getElementById("resPin").value;
    const totalAmount = document.getElementById("totalFeeDisplay").innerText;
    const emailInput = document.getElementById("studentEmail");
    const emailVal = emailInput ? emailInput.value.trim().toLowerCase() : "";
    if (!emailVal) {
        const errEl = document.getElementById('emailError');
        if (errEl) errEl.innerText = 'Please enter a valid email address.';
        alert('Please enter your email address for receiving your receipt and admit card.');
        return;
    }

    // Create student object in local mock database
    const newStudent = {
        fullName: nameVal,
        class: classVal,
        medium: mediumVal,
        schoolName: schoolVal,
        dob: document.getElementById("dateOfBirth").value,
        parentName: document.getElementById("parentName").value.toUpperCase(),
        whatsapp: document.getElementById("whatsappNumber").value,
        email: emailVal,
        address: resAddr,
        amount: totalAmount,
        payMode: selectedPaymentMode === "Cash" ? "Cash (Offline Pending)" : "UPI (Verified)",
        regNo: regNum,
        status: "Pending Verification",
        regDate: formattedDate
    };

    try {
        await saveStudentToDatabase(newStudent);
        mockDatabase.save(newStudent);
    } catch (error) {
        console.error("Failed to save registration to database", error);
        let errorMsg = error && error.message ? error.message : "Database save failed.";
        try {
            const parsed = JSON.parse(errorMsg);
            if (parsed && parsed.error) errorMsg = parsed.error;
        } catch (e) {}

        if (errorMsg.includes("already registered") || errorMsg.includes("409")) {
            alert("Mobile number is already registered! Please log in or use a different mobile number.");
            return;
        } else {
            alert(`Registration Error: ${errorMsg}`);
            return;
        }
    }

    // Populate Printable Receipt elements
    document.getElementById("recRegNo").innerText = regNum;
    document.getElementById("recDate").innerText = formattedDate;
    document.getElementById("recStudentName").innerText = nameVal;
    document.getElementById("recSchoolName").innerText = schoolVal;
    document.getElementById("recClassMedium").innerText = `Class ${classVal} - ${mediumVal}`;
    document.getElementById("recAmount").innerText = totalAmount;
    document.getElementById("recExamDate").innerText = "14 February 2027";
    document.getElementById("recExamTime").innerText = "10:00 AM to 12:00 PM";
    document.getElementById("recExamCentre").innerText = "MTDK School";
    
    const statusStamp = document.getElementById("recStatus");
    if (selectedPaymentMode === "Cash") {
        document.getElementById("recPayMode").innerText = "Cash (Offline Pending)";
        if (statusStamp) {
            statusStamp.innerText = "PENDING";
            statusStamp.className = "status-stamp pending";
        }
    } else {
        document.getElementById("recPayMode").innerText = "UPI (Verified)";
        if (statusStamp) {
            statusStamp.innerText = "PAID";
            statusStamp.className = "status-stamp approved";
        }
    }

    // Hide registration form wrapper, show receipt
    document.getElementById("imtseRegisterForm").reset();
    document.getElementById("rulesCheckbox").checked = false;
    document.getElementById("registration-section").classList.add("locked");
    document.getElementById("registration-section").style.display = "none";
    document.getElementById("rules-section").style.display = "none";
    
    const receiptBox = document.getElementById("acknowledgementReceipt");
    receiptBox.classList.remove("hidden");
    
    lucide.createIcons();
    scrollToSection("acknowledgementReceipt");
}

function resetFormAndRegisterAnother() {
    // Hide receipt page
    document.getElementById("acknowledgementReceipt").classList.add("hidden");
    
    // Show rules page & registration forms again
    document.getElementById("rules-section").style.display = "block";
    document.getElementById("registration-section").style.display = "block";
    
    // Reset steps markers
    currentStep = 1;
    document.querySelectorAll(".step-indicator").forEach((indicator, i) => {
        indicator.classList.remove("active", "completed");
        if (i === 0) indicator.classList.add("active");
    });
    
    // Reset inputs
    document.getElementById("imtseRegisterForm").reset();
    document.getElementById("rulesCheckbox").checked = false;
    document.getElementById("copyAddressBtn").checked = false;
    document.getElementById("declarationCheckbox").checked = false;
    
    // Reset simulators
    selectedPaymentMode = "";
    isPaymentApproved = false;
    document.getElementById("upiPaymentSimulator").classList.add("hidden");
    document.getElementById("cashPaymentNotice").classList.add("hidden");

    showStepContent(1);
}

// Safely format any DOB string (YYYY-MM-DD or DD/MM/YYYY etc.) to DDMMYYYY format
function getDobPasswordFormat(dobString) {
    if (!dobString) return "";
    const cleanDob = dobString.trim();

    // If an ISO or SQL datetime (has 'T' or space), extract the date part (YYYY-MM-DD) exactly
    let datePart = cleanDob;
    const tIdx = cleanDob.indexOf('T');
    if (tIdx !== -1) datePart = cleanDob.substring(0, tIdx);
    if (datePart.indexOf(' ') !== -1) datePart = datePart.split(' ')[0];
    // Check YYYY-MM-DD (standard HTML5 date input format)
    let match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return match[3] + match[2] + match[1]; // DDMMYYYY
    }

    // Check DD-MM-YYYY or DD/MM/YYYY
    match = cleanDob.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
    if (match) {
        return match[1] + match[2] + match[3]; // DDMMYYYY
    }

    // Fallback: strip non-digits and try to locate a YYYYMMDD or DDMMYYYY segment
    const digits = cleanDob.replace(/\D/g, "");
    if (digits.length === 8) {
        // If YYYYMMDD (starts with 19xx or 20xx), convert to DDMMYYYY
        if (parseInt(digits.substring(0, 4)) >= 1900 && parseInt(digits.substring(0, 4)) <= 2100) {
            return digits.substring(6, 8) + digits.substring(4, 6) + digits.substring(0, 4);
        }
        return digits; // Already DDMMYYYY
    }

    // If there are more digits (e.g. an ISO timestamp), try to find a YYYYMMDD chunk
    const longMatch = digits.match(/(19|20)\d{6}/);
    if (longMatch) {
        const d = longMatch[0];
        return d.substring(6, 8) + d.substring(4, 6) + d.substring(0, 4);
    }

    // Last resort: return last 8 digits (best-effort)
    return digits.slice(-8);
}

// Return DOB in canonical YYYY-MM-DD form without using Date parsing (avoids timezone shifts)
function getDobIsoFormat(dobString) {
    if (!dobString) return "";
    const s = String(dobString).trim();
    let datePart = s;
    const tIdx = s.indexOf('T');
    if (tIdx !== -1) datePart = s.substring(0, tIdx);
    if (datePart.indexOf(' ') !== -1) datePart = datePart.split(' ')[0];
    // If already YYYY-MM-DD
    const isoMatch = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return datePart;
    // If DDMMYYYY (digits only) convert
    const digits = s.replace(/\D/g, '');
    if (digits.length === 8) {
        // if YYYYMMDD
        if (parseInt(digits.substring(0,4)) >= 1900 && parseInt(digits.substring(0,4)) <= 2100) {
            return `${digits.substring(0,4)}-${digits.substring(4,6)}-${digits.substring(6,8)}`;
        }
        // assume DDMMYYYY
        return `${digits.substring(4,8)}-${digits.substring(2,4)}-${digits.substring(0,2)}`;
    }
    // Try DD-MM-YYYY or DD/MM/YYYY
    const dmMatch = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
    if (dmMatch) return `${dmMatch[3]}-${dmMatch[2]}-${dmMatch[1]}`;
    return "";
}

// ==================== LOGIN PORTAL & STUDENT DASHBOARD ====================
async function handleLoginSubmit(event) {
    event.preventDefault();
    
    const loginUser = document.getElementById("loginRegNo").value.trim().toUpperCase();
    const loginPass = document.getElementById("loginPass").value.trim();

    const loginPassDigits = (loginPass || "").replace(/\D/g, "");
    let existUser = null;

    // Simple authentication against mock local database (compare canonical YYYY-MM-DD)
    let foundStudent = mockDatabase.students.find(s => {
        const storedIso = getDobIsoFormat(s.dob);
        const loginIso = getDobIsoFormat(loginPass);
        const sReg = (s.regNo || "").toString().toUpperCase();
        const sWhats = (s.whatsapp || "").toString();
        return (sReg === loginUser || sWhats === loginUser) && storedIso && loginIso && storedIso === loginIso;
    });

    // If not found in local cache, attempt server-side lookup and authenticate against server data
    if (!foundStudent) {
        try {
            let matched = null;
            if (/^\d{10}$/.test(loginUser)) {
                const res = await fetch(`${API_BASE_URL}/api/students/${loginUser}`);
                if (res.ok) matched = await res.json();
            }
            if (!matched) {
                const resAll = await fetch(`${API_BASE_URL}/api/students`);
                if (resAll.ok) {
                    const all = await resAll.json();
                    matched = (all || []).find(s => ((s.reg_no || s.regNo || "").toString().toUpperCase() === loginUser) || ((s.whatsapp || "").toString() === loginUser));
                }
            }
            if (matched) {
                const serverDob = matched.dob || matched.DOB || matched.reg_date || matched.regDate;
                const storedIso = getDobIsoFormat(serverDob);
                const loginIso = getDobIsoFormat(loginPass);
                if (storedIso && loginIso && storedIso === loginIso) {
                    foundStudent = {
                        fullName: matched.full_name || matched.fullName,
                        class: matched.student_class || matched.class,
                        medium: matched.medium || matched.medium,
                        schoolName: matched.school_name || matched.schoolName,
                        dob: serverDob,
                        parentName: matched.parent_name || matched.parentName,
                        whatsapp: (matched.whatsapp || "").toString(),
                        address: matched.address,
                        amount: matched.amount,
                        payMode: matched.pay_mode || matched.payMode,
                        regNo: matched.reg_no || matched.regNo,
                        status: matched.status,
                        regDate: matched.reg_date || matched.regDate
                    };
                    try { mockDatabase.save(foundStudent); } catch (e) { /* ignore */ }
                } else {
                    existUser = {
                        fullName: matched.full_name || matched.fullName,
                        dob: serverDob
                    };
                }
            }
        } catch (e) {
            console.warn('Server auth lookup failed', e && e.message ? e.message : e);
        }
    }

    if (foundStudent) {
        activeStudentSession = foundStudent;
        showDashboardView(foundStudent);
        return;
    }

    const debugMessage = existUser
        ? 'Invalid password. Use your DOB in YYYY-MM-DD or DDMMYYYY format.'
        : 'Invalid login credentials. Please verify your registration number or mobile number and DOB.';

    alert(debugMessage);
    const dbg = document.getElementById('loginDebug');
    const dbgText = document.getElementById('loginDebugText');
    if (dbg && dbgText) {
        dbg.style.display = 'block';
        dbgText.textContent = debugMessage;
    }
}

function loginDirectlyFromReceipt() {
    // Get the most recently registered student
    const count = mockDatabase.students.length;
    if (count > 0) {
        const lastStudent = mockDatabase.students[count - 1];
        activeStudentSession = lastStudent;
        
        // Hide receipt and rules sections
        document.getElementById("acknowledgementReceipt").classList.add("hidden");
        document.getElementById("rules-section").style.display = "block";
        document.getElementById("registration-section").style.display = "block";
        
        // Switch tab to login, showing the active dashboard
        switchTab("login");
        showDashboardView(lastStudent);
    }
}

function showDashboardView(student) {
    // Hide login form box, show dashboard panel
    document.getElementById("login-form-box").classList.add("hidden");
    document.getElementById("student-dashboard").classList.remove("hidden");

    // Populate profile fields
    document.getElementById("dashName").innerText = student.fullName;
    document.getElementById("dashClass").innerText = `Class ${student.class} (${student.medium} Medium)`;
    document.getElementById("dashRegId").innerText = `Reg No: ${student.regNo}`;
    
    const firstName = student.fullName.split(" ")[0];
    document.getElementById("dashFirstName").innerText = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    
    // Status text update
    const statusTxt = document.getElementById("dashRegStatus");
    const statusDot = statusTxt.previousElementSibling;
    const studentStatus = student.status || "";
    statusTxt.innerText = studentStatus;

    const isApproved = studentStatus.toLowerCase().includes("approved") || studentStatus.toLowerCase().includes("active");
    const isPending = studentStatus.toLowerCase().includes("pending");
    const isRejected = studentStatus.toLowerCase().includes("rejected");

    if (isApproved) {
        statusDot.className = "status-dot green";
    } else if (isRejected) {
        statusDot.className = "status-dot red";
    } else {
        statusDot.className = "status-dot yellow";
    }

    // Show status notice banner
    let existingNotice = document.getElementById("dashStatusNotice");
    if (!existingNotice) {
        existingNotice = document.createElement("div");
        existingNotice.id = "dashStatusNotice";
        existingNotice.style.cssText = "margin:14px 0;padding:14px 18px;border-radius:10px;font-size:14px;font-weight:600;";
        const dashRegId = document.getElementById("dashRegId");
        dashRegId.parentNode.insertBefore(existingNotice, dashRegId.nextSibling);
    }
    if (isPending) {
        existingNotice.style.display = "block";
        existingNotice.style.background = "#fef9c3";
        existingNotice.style.color = "#92400e";
        existingNotice.style.border = "1px solid #fde68a";
        existingNotice.innerHTML = "Your registration is <strong>under review</strong> by the admin.";
    } else if (isRejected) {
        existingNotice.style.display = "block";
        existingNotice.style.background = "#fee2e2";
        existingNotice.style.color = "#991b1b";
        existingNotice.style.border = "1px solid #fca5a5";
        existingNotice.innerHTML = "Your registration has been <strong>rejected</strong>. Please contact MTDK School.";
    } else if (isApproved) {
        existingNotice.style.display = "block";
        existingNotice.style.background = "#f0fdf4";
        existingNotice.style.color = "#166534";
        existingNotice.style.border = "1px solid #86efac";
        existingNotice.innerHTML = "Your registration is <strong>approved</strong>! Admit card available from 01 Aug 2024 10:30.";
    } else {
        existingNotice.style.display = "none";
    }

    // Hall Ticket Download Button
    const admitCardBtn = document.querySelector(".sidebar-item[onclick*='downloadHallTicket']") ||
                         document.querySelector("[onclick*='downloadHallTicket']");
    const hallTicketUnlockDate = new Date(2024, 7, 1, 10, 30);
    const today = new Date();
    const isUnlocked = today >= hallTicketUnlockDate;

    if (admitCardBtn) {
        if (!isApproved) {
            admitCardBtn.style.opacity = "0.4";
            admitCardBtn.style.pointerEvents = "none";
            admitCardBtn.title = isPending
                ? "Admit card will be available after admin approval"
                : isRejected
                ? "Registration rejected"
                : "Not available";
        } else if (!isUnlocked) {
            admitCardBtn.style.opacity = "0.5";
            admitCardBtn.style.pointerEvents = "none";
            admitCardBtn.title = "Admit card will be available from 01 August 2024 10:30";
        } else {
            admitCardBtn.style.opacity = "1";
            admitCardBtn.style.pointerEvents = "auto";
            admitCardBtn.title = "Download Hall Ticket";
        }
    }

    // Countdown calculations (Exam: 14 Feb 2027)
    const examDate = new Date(2027, 1, 14);
    const diffTime = examDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const countDisplay = document.getElementById("countdownDays");
    if (diffDays > 0) {
        countDisplay.innerText = diffDays;
    } else if (diffDays === 0) {
        countDisplay.innerText = "TODAY";
    } else {
        countDisplay.innerText = "OVER";
    }

    renderStudentResources();
    lucide.createIcons();
}

function handleDashboardLogout() {
    activeStudentSession = null;
    document.getElementById("imtseLoginForm").reset();
    
    document.getElementById("student-dashboard").classList.add("hidden");
    document.getElementById("login-form-box").classList.remove("hidden");
    
    switchTab("home");
}

function getClassPrefix(clsInput) {
    const cls = String(clsInput || "").trim().toUpperCase();
    if (/\b(I|1|1ST)\b/.test(cls)) return "A";
    if (/\b(II|2|2ND)\b/.test(cls)) return "B";
    if (/\b(III|3|3RD)\b/.test(cls)) return "C";
    if (/\b(IV|4|4TH)\b/.test(cls)) return "D";
    if (/\b(V|5|5TH)\b/.test(cls)) return "E";
    if (/\b(VI|6|6TH)\b/.test(cls)) return "F";
    if (/\b(VII|7|7TH)\b/.test(cls)) return "G";
    if (/\b(VIII|8|8TH)\b/.test(cls)) return "H";
    if (/\b(IX|9|9TH)\b/.test(cls)) return "I";
    if (/\b(X|10|10TH)\b/.test(cls)) return "J";
    return "A";
}

function getRollNoForStudent(student) {
    if (!student) return "A202701";
    if (student.rollNo && /^[A-J]2027\d{2,}$/i.test(student.rollNo)) {
        return student.rollNo.toUpperCase();
    }
    const prefix = getClassPrefix(student.class);
    const year = "2027";
    let seq = "01";
    if (student.regNo) {
        const digits = student.regNo.replace(/\D/g, "");
        if (digits.length >= 2) {
            const num = (parseInt(digits.slice(-2), 10) % 99) || 1;
            seq = String(num).padStart(2, "0");
        }
    }
    return `${prefix}${year}${seq}`;
}

function generateOfficialHallTicketHtml(student) {
    const studentName = student.fullName || '';
    const studentClass = student.class ? `Class ${student.class} (${student.medium || 'English'} Medium)` : '';
    const schoolName = student.schoolName || '';
    const seatNo = getRollNoForStudent(student);
    const examCentre = student.schoolName ? `${student.schoolName} / Miraj Centre` : 'Nearest Assigned Exam Centre';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>IMTSE Hall Ticket 2026-27 - ${studentName}</title>
<style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 20px;
        background: #fff;
        color: #000;
    }
    .hall-ticket-outer {
        border: 3px double #000;
        padding: 20px;
        max-width: 850px;
        margin: 0 auto;
        background: #fff;
    }
    .header-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
    }
    .header-main-title {
        text-align: center;
        vertical-align: top;
        padding-right: 15px;
    }
    .header-main-title h1 {
        font-size: 22px;
        font-weight: 800;
        margin: 0 0 6px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #000;
    }
    .header-main-title h2 {
        font-size: 18px;
        font-weight: 800;
        margin: 0;
        text-transform: uppercase;
        color: #000;
    }
    .header-boxes-col {
        width: 250px;
        vertical-align: top;
    }
    .info-box {
        border: 1px solid #000;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 10px;
        line-height: 1.6;
    }
    .info-box:last-child {
        margin-bottom: 0;
    }
    .student-details-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 24px;
        font-size: 15px;
    }
    .student-details-table td {
        padding: 8px 4px;
        vertical-align: baseline;
    }
    .label-col {
        width: 160px;
        font-weight: 700;
        white-space: nowrap;
    }
    .colon-col {
        width: 20px;
        font-weight: 700;
        text-align: center;
    }
    .val-col {
        border-bottom: 1px solid #000;
        font-weight: 600;
        padding-left: 6px !important;
    }
    .signatures-table {
        width: 100%;
        border-collapse: collapse;
        margin: 25px 0 20px 0;
        font-size: 14px;
        font-weight: 700;
    }
    .signatures-table td {
        padding: 6px 0;
        vertical-align: baseline;
    }
    .sig-line-cell {
        border-bottom: 1px solid #000;
        width: 220px;
    }
    .rules-container {
        border: 1px solid #000;
        border-radius: 12px;
        position: relative;
        padding: 20px 16px 14px 16px;
        margin-top: 15px;
    }
    .rules-header-badge {
        position: absolute;
        top: -13px;
        left: 50%;
        transform: translateX(-50%);
        background: #fff;
        border: 1px solid #000;
        border-radius: 6px;
        padding: 2px 20px;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.5px;
    }
    .rules-grid-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        line-height: 1.6;
    }
    .rules-grid-table td {
        width: 50%;
        vertical-align: top;
        padding: 0 10px;
    }
    .rule-row {
        margin-bottom: 8px;
        display: flex;
        align-items: flex-start;
    }
    .rule-num {
        font-weight: 700;
        min-width: 22px;
    }
    .rule-divider {
        border-right: 1px solid #000;
    }
    .footer-stars-row {
        text-align: center;
        margin-top: 18px;
        font-size: 13px;
        font-weight: 700;
        border-top: 1px solid #000;
        padding-top: 10px;
    }
    .footer-stars-row span {
        font-style: italic;
        margin: 0 12px;
    }
    @media print {
        body { padding: 0; }
        .no-print { display: none !important; }
    }
</style>
</head>
<body>
<div class="no-print" style="text-align: center; margin-bottom: 15px;">
    <button onclick="window.print()" style="padding: 10px 24px; font-size: 16px; font-weight: bold; background: #0f2b5c; color: white; border: none; border-radius: 6px; cursor: pointer;">
        Print / Download Hall Ticket
    </button>
</div>

<div class="hall-ticket-outer">
    <table class="header-table">
        <tr>
            <td class="header-main-title">
                <h1>IGNITED MINDS TALENT SEARCH EXAM</h1>
                <h2>HALL TICKET (2026-27)</h2>
            </td>
            <td class="header-boxes-col">
                <div class="info-box">
                    <div>Exam Date : <strong>14 February 2027</strong></div>
                    <div>Time : <strong>10:00 AM to 12:00 PM</strong></div>
                </div>
                <div class="info-box">
                    <div>Seat No. : <strong>${seatNo}</strong></div>
                </div>
            </td>
        </tr>
    </table>

    <table class="student-details-table">
        <tr>
            <td class="label-col">Student Name</td>
            <td class="colon-col">:</td>
            <td class="val-col">${studentName}</td>
        </tr>
        <tr>
            <td class="label-col">Class</td>
            <td class="colon-col">:</td>
            <td class="val-col">${studentClass}</td>
        </tr>
        <tr>
            <td class="label-col">School Name</td>
            <td class="colon-col">:</td>
            <td class="val-col">${schoolName}</td>
        </tr>
        <tr>
            <td class="label-col">Exam Centre</td>
            <td class="colon-col">:</td>
            <td class="val-col">${examCentre}</td>
        </tr>
    </table>

    <table class="signatures-table">
        <tr>
            <td style="width: 140px;">Student Signature</td>
            <td style="width: 20px; text-align: center;">:</td>
            <td class="sig-line-cell"></td>
            <td style="width: 40px;"></td>
            <td style="width: 130px;">Invigilator Sign</td>
            <td style="width: 20px; text-align: center;">:</td>
            <td class="sig-line-cell"></td>
        </tr>
    </table>

    <div class="rules-container">
        <div class="rules-header-badge">RULES AND REGULATIONS</div>
        <table class="rules-grid-table">
            <tr>
                <td class="rule-divider">
                    <div class="rule-row"><span class="rule-num">1.</span><span>हा हॉल तिकीट परीक्षा केंद्रात सोबत आणणे आवश्यक आहे.</span></div>
                    <div class="rule-row"><span class="rule-num">2.</span><span>परीक्षेला 30 मिनिटे आधी परीक्षा केंद्रावर उपस्थित राहावे.</span></div>
                    <div class="rule-row"><span class="rule-num">3.</span><span>स्वतःचा निळा/काळा बॉल पेन सोबत आणावा.</span></div>
                    <div class="rule-row"><span class="rule-num">4.</span><span>मोबाईल फोन, स्मार्ट वॉच व इतर इलेक्ट्रॉनिक साधने पूर्णपणे बंदी आहेत.</span></div>
                    <div class="rule-row"><span class="rule-num">5.</span><span>उत्तरपत्रिकेवर आपले नाव व सीट क्रमांक योग्यरीत्या लिहावा.</span></div>
                </td>
                <td>
                    <div class="rule-row"><span class="rule-num">6.</span><span>उत्तर लिहाव्यांच्या उत्तरपत्रिकेकडे पहाची किंवा कोणतीही मदत घेणे/देणे गुन्हा आहे.</span></div>
                    <div class="rule-row"><span class="rule-num">7.</span><span>परीक्षेदरम्यान कोणतीही अनुचित हालचाल केल्यास किंवा नियमांचे उल्लंघन केल्यास आपली परीक्षा रद्द केली जाऊ शकते.</span></div>
                    <div class="rule-row"><span class="rule-num">8.</span><span>प्रश्नपत्रिका मिळाल्यावर ती पूर्ण तपासावी. काही त्रुटी असल्यास त्वरित पर्यवेक्षकांना कळवावे.</span></div>
                    <div class="rule-row"><span class="rule-num">9.</span><span>परीक्षा संपल्यावर उत्तरपत्रिका व प्रश्नपत्रिका पर्यवेक्षकांकडे जमा करावी.</span></div>
                    <div class="rule-row"><span class="rule-num">10.</span><span>वरील नियमांचे पालन करणे सर्व विद्यार्थ्यांसाठी अनिवार्य आहे.</span></div>
                </td>
            </tr>
        </table>
    </div>

    <div class="footer-stars-row">
        * * * <span>Initiative by MTDK Shaikshnik Sankul</span> * * *
    </div>
</div>
</body>
</html>`;
}

function downloadHallTicket(studentOverride = null) {
    const student = studentOverride || activeStudentSession;
    if (!student) {
        alert("Please login or select a student to download the Hall Ticket.");
        return;
    }

    const htmlContent = generateOfficialHallTicketHtml(student);
    const win = window.open('', '_blank');
    if (win) {
        win.document.open();
        win.document.write(htmlContent);
        win.document.close();
        win.onload = function() {
            win.print();
        };
    } else {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `IMTSE_HallTicket_${(student.regNo || student.whatsapp || 'ticket').replace(/[^a-zA-Z0-9_-]/g, '')}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

function populateAdminCategoryOptions() {
    const categorySelect = document.getElementById("resourceCategory");
    if (!categorySelect) return;
    categorySelect.innerHTML = adminCategories.map(category => `<option value="${category.value}">${category.label}</option>`).join("");
}

function renderAdminStudents() {
    const tableBody = document.getElementById("adminStudentsTable");
    if (!tableBody) return;

    // Sort: Pending Verification first, then others
    const sorted = [...dbStudents].sort((a, b) => {
        const aP = (a.status || "").toLowerCase().includes("pending");
        const bP = (b.status || "").toLowerCase().includes("pending");
        return (bP ? 1 : 0) - (aP ? 1 : 0);
    });

    tableBody.innerHTML = sorted.map(student => {
        const studentId = student.regNo || student.whatsapp;
        const isPending = (student.status || "").toLowerCase().includes("pending");
        const isRejected = (student.status || "").toLowerCase().includes("rejected");
        const isApproved = !isPending && !isRejected;

        const statusColor = isPending ? "#f59e0b" : isRejected ? "#dc2626" : "#16a34a";
        const statusBg = isPending ? "#fef9c3" : isRejected ? "#fee2e2" : "#f0fdf4";

        const approveRejectBtns = isPending ? `
            <button style="background:#16a34a;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px;" 
                type="button" onclick="approveStudentFromAdmin('${studentId}')">Accept</button>
            <button style="background:#dc2626;color:white;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;margin-right:4px;" 
                type="button" onclick="rejectStudentFromAdmin('${studentId}')">Reject</button>
        ` : ``;

        return `
            <tr style="${isPending ? 'background:#fffbeb;' : ''}">
                <td><strong>${student.fullName || ""}</strong>${student.email ? `<br><small style="color:#64748b;">${student.email}</small>` : ""}</td>
                <td>${student.class || ""}</td>
                <td>${student.whatsapp || ""}</td>
                <td><span style="background:${statusBg};color:${statusColor};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;">${student.status || ""}</span></td>
                <td>
                    ${approveRejectBtns}
                    <button class="btn-secondary" type="button" onclick="adminViewHallTicket('${studentId}')">Hall Ticket</button>
                    <button class="btn-secondary" type="button" onclick="editStudentFromAdmin('${studentId}')">Edit</button>
                    <button class="btn-secondary" type="button" onclick="deleteStudentFromAdmin('${studentId}')">Remove</button>
                </td>
            </tr>
        `;
    }).join("");

    // Show pending count badge
    const pendingCount = dbStudents.filter(s => (s.status || "").toLowerCase().includes("pending")).length;
    const header = document.querySelector("#adminStudentPanel .admin-card-header h3");
    if (header) {
        header.innerHTML = `Student Profiles ${pendingCount > 0 ? `<span style="background:#dc2626;color:white;font-size:11px;padding:2px 8px;border-radius:10px;margin-left:8px;">${pendingCount} Pending</span>` : ""}`;
    }
}

function renderAdminResources() {
    const tableBody = document.getElementById("adminResourcesTable");
    if (!tableBody) return;
    tableBody.innerHTML = dbResources.map(resource => `
        <tr>
            <td>${resource.title}</td>
            <td>${adminCategories.find(cat => cat.value === resource.category)?.label || resource.category}</td>
            <td>${resource.type}</td>
            <td><a href="javascript:void(0)" onclick="openOrDownloadResource('${resource.id}')">Open</a></td>
            <td>
                <button class="btn-secondary" type="button" onclick="editResourceFromAdmin('${resource.id}')">Edit</button>
                <button class="btn-secondary" type="button" onclick="deleteResourceFromAdmin('${resource.id}')">Remove</button>
            </td>
        </tr>
    `).join("");
}

function getCategoryForClass(className) {
    const cls = String(className || "").trim().toUpperCase();
    if (/\b(I|1|1ST)\b/.test(cls) || /\b(II|2|2ND)\b/.test(cls)) return "std-i-ii";
    if (/\b(III|3|3RD)\b/.test(cls) || /\b(IV|4|4TH)\b/.test(cls)) return "std-iii-iv";
    if (/\b(V|5|5TH)\b/.test(cls) || /\b(VI|6|6TH)\b/.test(cls)) return "std-v-vi";
    if (/\b(VII|7|7TH)\b/.test(cls) || /\b(VIII|8|8TH)\b/.test(cls)) return "std-vii-viii";
    if (/\b(IX|9|9TH)\b/.test(cls) || /\b(X|10|10TH)\b/.test(cls)) return "std-ix-x";
    return "";
}

function renderStudentResources() {
    const container = document.getElementById("studentResourcesList");
    if (!container) return;
    
    let resourcesToRender = dbResources;
    if (activeStudentSession && activeStudentSession.class) {
        const targetCategory = getCategoryForClass(activeStudentSession.class);
        resourcesToRender = dbResources.filter(resource => resource.category === targetCategory);
    }

    const resourcesMarkup = resourcesToRender.map(resource => `
        <a href="javascript:void(0)" onclick="openOrDownloadResource('${resource.id}')" class="download-item">
            <i data-lucide="download-cloud"></i>
            <span>${resource.title} (${adminCategories.find(cat => cat.value === resource.category)?.label || resource.category})</span>
        </a>
    `).join("");
    container.innerHTML = resourcesMarkup || '<div class="empty-state">No study resources added yet.</div>';
    lucide.createIcons();
}

function resetAdminStudentForm() {
    document.getElementById("adminStudentForm").reset();
    document.getElementById("adminStudentId").value = "";
    document.getElementById("adminStudentRegNo").value = "";
    document.getElementById("adminStudentDob").value = "2014-08-15";
    document.getElementById("adminStudentClass").value = "VII";
}

function resetAdminResourceForm() {
    document.getElementById("adminResourceForm").reset();
    document.getElementById("adminResourceId").value = "";
    document.getElementById("resourceCategory").value = "std-i-ii";
    document.getElementById("resourceFile").value = "";
    toggleResourceInputMode();
}

function showAdminPanel(panelName) {
    const studentPanel = document.getElementById("adminStudentPanel");
    const resourcePanel = document.getElementById("adminResourcePanel");
    const buttons = document.querySelectorAll(".panel-toggle");

    if (panelName === "resources") {
        studentPanel.classList.add("hidden");
        resourcePanel.classList.remove("hidden");
    } else {
        studentPanel.classList.remove("hidden");
        resourcePanel.classList.add("hidden");
    }

    buttons.forEach(button => {
        button.classList.toggle("active", button.textContent.includes(panelName === "resources" ? "Study Resources" : "Student Profiles"));
    });
}

function toggleResourceInputMode() {
    const resourceType = document.getElementById("resourceType")?.value;
    const urlWrapper = document.getElementById("resourceUrlWrapper");
    const fileWrapper = document.getElementById("resourceFileWrapper");
    const fileInput = document.getElementById("resourceFile");
    const urlInput = document.getElementById("resourceUrl");
    if (!urlWrapper || !fileWrapper || !fileInput || !urlInput) return;

    if (resourceType === "YouTube") {
        urlWrapper.classList.remove("hidden");
        fileWrapper.classList.add("hidden");
        fileInput.value = "";
        urlInput.required = true;
        fileInput.required = false;
    } else {
        urlWrapper.classList.add("hidden");
        fileWrapper.classList.remove("hidden");
        urlInput.required = false;
        fileInput.required = true;
        urlInput.value = "";
    }
}

function handleAdminLogin(event) {
    event.preventDefault();
    const username = document.getElementById("adminUsername").value.trim();
    const password = document.getElementById("adminPassword").value;
    if (username === "admin" && password === "admin") {
        adminSession = true;
        document.getElementById("adminAccessCard").classList.add("hidden");
        document.getElementById("adminPanelContent").classList.remove("hidden");
        alert("Admin panel unlocked.");
    } else {
        alert("Incorrect admin credentials.");
    }
}

function logoutAdmin() {
    adminSession = false;
    document.getElementById("adminPassword").value = "";
    document.getElementById("adminAccessCard").classList.remove("hidden");
    document.getElementById("adminPanelContent").classList.add("hidden");
}

async function saveStudentFromAdmin(event) {
    event.preventDefault();
    const studentId = document.getElementById("adminStudentId").value;
    const form = document.getElementById("adminStudentForm");
    const studentData = {
        fullName: document.getElementById("adminStudentName").value.toUpperCase(),
        class: document.getElementById("adminStudentClass").value,
        medium: document.getElementById("adminStudentMedium").value,
        schoolName: document.getElementById("adminStudentSchool").value.toUpperCase(),
        dob: document.getElementById("adminStudentDob").value,
        parentName: document.getElementById("adminStudentParent").value.toUpperCase(),
        whatsapp: document.getElementById("adminStudentPhone").value,
        address: document.getElementById("adminStudentAddress").value,
        amount: document.getElementById("adminStudentAmount").value,
        payMode: document.getElementById("adminStudentPayMode").value,
        regNo: document.getElementById("adminStudentRegNo").value || `IMTSE-${Math.floor(10000 + Math.random() * 90000)}`,
        status: document.getElementById("adminStudentStatus").value,
        regDate: document.getElementById("adminStudentRegDate").value || new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    };

    try {
        if (studentId) {
            await saveStudentToDatabase(studentData, studentId);
        } else {
            await saveStudentToDatabase(studentData);
        }

        await loadStudentsFromDatabase();
        form.reset();
        resetAdminStudentForm();
        alert("Student profile saved successfully.");
    } catch (error) {
        console.error("Failed to save student to database", error);
        alert("Could not save student to the database. Please check the server connection.");
    }
}

function editStudentFromAdmin(regNo) {
    const student = dbStudents.find(item => item.regNo === regNo || item.whatsapp === regNo);
    if (!student) return;
    document.getElementById("adminStudentId").value = student.regNo || student.whatsapp;
    document.getElementById("adminStudentName").value = student.fullName;
    document.getElementById("adminStudentClass").value = student.class;
    document.getElementById("adminStudentMedium").value = student.medium;
    document.getElementById("adminStudentSchool").value = student.schoolName;
    document.getElementById("adminStudentDob").value = student.dob;
    document.getElementById("adminStudentPhone").value = student.whatsapp;
    document.getElementById("adminStudentAddress").value = student.address;
    document.getElementById("adminStudentAmount").value = student.amount;
    document.getElementById("adminStudentPayMode").value = student.payMode;
    document.getElementById("adminStudentRegNo").value = student.regNo;
    document.getElementById("adminStudentStatus").value = student.status;
    document.getElementById("adminStudentParent").value = student.parentName;
    document.getElementById("adminStudentRegDate").value = student.regDate;
    scrollToSection("admin-view");
}

async function deleteStudentFromAdmin(regNo) {
    if (confirm("Remove this student profile?")) {
        try {
            await deleteStudentFromDatabase(regNo);
            await loadStudentsFromDatabase();
            alert("Student removed.");
        } catch (error) {
            console.error("Failed to delete student from database", error);
            alert("Could not remove the student from the database.");
        }
    }
}

async function approveStudentFromAdmin(regNo) {
    if (!confirm("Approve this student?")) return;
    try {
        const student = dbStudents.find(s => s.regNo === regNo || s.whatsapp === regNo);
        if (!student) {
            alert("Student not found.");
            return;
        }

        const response = await fetch(`${API_BASE_URL}/api/students/${encodeURIComponent(regNo)}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(payload.error || `Approval failed with status ${response.status}`);
        }

        student.status = "Approved & Active (Fees Paid)";
        mockDatabase.updateStudent(student);
        await loadStudentsFromDatabase();

        if (payload.emailSent) {
            alert("Student approved successfully and the approval email was sent.");
        } else {
            alert(`Student approved, but the approval email could not be sent. ${payload.reason || ''}`.trim());
        }
    } catch (error) {
        console.error("Failed to approve student", error);
        alert("Could not approve student: " + error.message);
    }
}

async function rejectStudentFromAdmin(regNo) {
    if (!confirm("Reject this student's registration?")) return;
    try {
        const student = dbStudents.find(s => s.regNo === regNo || s.whatsapp === regNo);
        if (student) {
            student.status = "Rejected";
            mockDatabase.updateStudent(student);
            try { await saveStudentToDatabase(student, regNo); } catch (e) { console.warn("Server save failed", e); }
        }
        await loadStudentsFromDatabase();
        alert("Student registration rejected.");
    } catch (error) {
        console.error("Failed to reject student", error);
        alert("Could not reject student: " + error.message);
    }
}

function adminViewHallTicket(regNo) {
    const student = dbStudents.find(s => s.regNo === regNo || s.whatsapp === regNo);
    if (student) {
        downloadHallTicket(student);
    } else {
        alert("Student not found.");
    }
}

async function saveResourceFromAdmin(event) {
    event.preventDefault();
    const resourceId = document.getElementById("adminResourceId").value;
    const resourceType = document.getElementById("resourceType").value;
    const fileInput = document.getElementById("resourceFile");
    const resourceData = {
        title: document.getElementById("resourceTitle").value,
        category: document.getElementById("resourceCategory").value,
        type: resourceType,
        url: document.getElementById("resourceUrl").value,
        description: document.getElementById("resourceDescription").value,
        fileName: "",
        fileData: ""
    };

    if (resourceType !== "YouTube" && fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        resourceData.fileName = file.name;
        resourceData.fileData = await readFileAsDataUrl(file);
    } else {
        resourceData.url = document.getElementById("resourceUrl").value;
    }

    try {
        await saveResourceToDatabase(resourceData, resourceId || null);
        await loadResourcesFromDatabase();
        resetAdminResourceForm();
        alert("Resource saved successfully to database.");
    } catch (error) {
        console.error("Failed to save resource to database", error);
        if (resourceId) {
            mockDatabase.updateResource({ ...resourceData, id: Number(resourceId) });
        } else {
            mockDatabase.saveResource({ ...resourceData, id: Date.now() });
        }
        resetAdminResourceForm();
        renderAdminResources();
        renderStudentResources();
        alert("Resource saved locally (database sync fallback).");
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
    });
}

function editResourceFromAdmin(resourceId) {
    const resource = dbResources.find(item => item.id === resourceId);
    if (!resource) return;
    document.getElementById("adminResourceId").value = resource.id;
    document.getElementById("resourceTitle").value = resource.title;
    document.getElementById("resourceCategory").value = resource.category;
    document.getElementById("resourceType").value = resource.type;
    document.getElementById("resourceUrl").value = resource.url;
    document.getElementById("resourceDescription").value = resource.description;
    scrollToSection("admin-view");
}

async function deleteResourceFromAdmin(resourceId) {
    if (confirm("Remove this study resource?")) {
        try {
            await deleteResourceFromDatabase(resourceId);
            await loadResourcesFromDatabase();
            alert("Resource removed from database.");
        } catch (error) {
            console.error("Failed to delete resource from database", error);
            mockDatabase.deleteResource(resourceId);
            renderAdminResources();
            renderStudentResources();
            alert("Resource removed locally.");
        }
    }
}

function openOrDownloadResource(resourceId) {
    const resource = dbResources.find(item => String(item.id) === String(resourceId));
    if (!resource) {
        alert("Resource not found.");
        return;
    }

    // Handle uploaded file (base64 Data URL)
    if (resource.fileData && typeof resource.fileData === 'string' && resource.fileData.startsWith('data:')) {
        try {
            const parts = resource.fileData.split(',');
            const mimeMatch = parts[0].match(/:(.*?);/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
            const bstr = atob(parts[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
                u8arr[n] = bstr.charCodeAt(n);
            }
            const blob = new Blob([u8arr], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);

            const win = window.open(blobUrl, '_blank');
            if (!win) {
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = resource.fileName || `${resource.title || 'resource'}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
            return;
        } catch (err) {
            console.error('Failed to open base64 blob:', err);
        }
    }

    // Handle Web URL
    let rawUrl = (resource.url || '').trim();
    if (rawUrl) {
        if (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith('data:') && !rawUrl.startsWith('blob:')) {
            rawUrl = 'https://' + rawUrl;
        }
        window.open(rawUrl, '_blank', 'noopener,noreferrer');
        return;
    }

    alert('No file or web link is attached to this study resource.');
}

