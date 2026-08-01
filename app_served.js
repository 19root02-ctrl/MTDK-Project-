// ==================== INITIALIZATION ====================
document.addEventListener("DOMContentLoaded", () => {
    // Initialize Lucide Icons
    lucide.createIcons();

    populateAdminCategoryOptions();
    renderAdminStudents();
    renderAdminResources();
    renderStudentResources();
    showAdminPanel("students");
    toggleResourceInputMode();
    loadStudentsFromDatabase();
    
    // Set initial date defaults
    const today = new Date();
    // Default DOB to 10 years ago for typical student profile
    const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
    const dobInput = document.getElementById("dateOfBirth");
    if (dobInput) {
        dobInput.value = tenYearsAgo.toISOString().split('T')[0];
    }

    // Default fee calculation
    updateDynamicFee();

    // Check URL hashes for routing
    const hash = window.location.hash.replace("#", "");
    if (hash && ["home", "about", "exam", "admin", "login"].includes(hash)) {
        switchTab(hash);
    }
});

const adminCategories = [
    { value: "std-i-ii", label: "Std I-II" },
    { value: "std-iii-iv", label: "Std III-IV" },
    { value: "std-v-vi", label: "Std V-VI" },
    { value: "std-vii-viii", label: "Std VII-VIII" },
    { value: "std-ix-x", label: "Std IX-X" }
];

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
const API_BASE_URL = "http://127.0.0.1:3000";
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
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!response.ok) {
        const msg = body && (body.error || body.message) ? (body.error || body.message) : (text || `Student save failed with status ${response.status}`);
        throw new Error(msg);
    }
    return body;
}

async function deleteStudentFromDatabase(regNo) {
    const response = await fetch(`${API_BASE_URL}/api/students/${encodeURIComponent(regNo)}`, { method: "DELETE" });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!response.ok) {
        const msg = body && (body.error || body.message) ? (body.error || body.message) : (text || `Student deletion failed with status ${response.status}`);
        throw new Error(msg);
    }
    return body;
}

// State Variables
let currentStep = 1;
let selectedPaymentMode = "";
let isPaymentApproved = false;
let upiTimerInterval = null;
let activeStudentSession = null;
let whatsappAvailable = true; // if false, number is already registered

function debounce(fn, wait) {
    let t = null;
    return function(...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
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
    // If moving from step 1 -> 2, ensure phone is valid and unique first
    if (currentStep === 1 && step === 2) {
        const ok = await ensureWhatsappAvailable();
        if (!ok) return; // stay on current step
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



async function ensureWhatsappAvailable() {
    const whatsappInput = document.getElementById('whatsappNumber');
    const whatsappError = document.getElementById('whatsappError');
    const continueBtn = document.getElementById('continueToAddressBtn');
    if (!whatsappInput) return true; // nothing to check

    const val = whatsappInput.value.trim();

    // Reset UI state first
    whatsappAvailable = true;
    whatsappInput.classList.remove('invalid');
    if (whatsappError) {
        whatsappError.innerText = '';
        whatsappError.classList.remove('active');
    }
    if (continueBtn) continueBtn.disabled = true;

    // Validate format
    if (!/^\d{10}$/.test(val)) {
        whatsappAvailable = false;
        whatsappInput.classList.add('invalid');
        if (whatsappError) {
            whatsappError.innerText = 'Please enter a valid 10-digit mobile number.';
            whatsappError.classList.add('active');
        }
        if (continueBtn) continueBtn.disabled = true;
        return false;
    }

    // local cache check
    const localExists = dbStudents.some(s => String(s.whatsapp || '').trim() === val);
    if (localExists) {
        whatsappAvailable = false;
        whatsappInput.classList.add('invalid');
        if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
        if (whatsappError) {
            whatsappError.innerText = 'Mobile number already registered';
            whatsappError.classList.add('active');
        }
        if (continueBtn) continueBtn.disabled = true;
        return false;
    }

    // server check
    try {
        const res = await fetch(`${API_BASE_URL}/api/students/${val}`);

        if (res.ok) {
            // exists
            whatsappAvailable = false;
            whatsappInput.classList.add('invalid');
            if (whatsappError) {
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
            }
            if (continueBtn) continueBtn.disabled = true;
            return false;
        }

        if (res.status === 404) {
            // available
            whatsappAvailable = true;
            whatsappInput.classList.remove('invalid');
            if (whatsappError) {
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
            }
            if (continueBtn) continueBtn.disabled = false;
            return true;
        }

        // Server responded but with an unexpected status (500/403/etc.)
        // Do NOT block registration with a wrong message.
        whatsappAvailable = true;
        whatsappInput.classList.remove('invalid');
        if (whatsappError) {
            whatsappError.innerText = 'Server is busy/unreachable. Please try again.';
            whatsappError.classList.add('active');
        }
        if (continueBtn) continueBtn.disabled = false;
        return true;
    } catch (e) {
        // network error => do NOT mark as already registered
        whatsappAvailable = true;
        whatsappInput.classList.remove('invalid');
        if (whatsappError) {
            whatsappError.innerText = 'Server is unreachable. You can continue, but final verification may fail.';
            whatsappError.classList.add('active');
        }
        if (continueBtn) continueBtn.disabled = false;
        return true;
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
            alert("Mobile number already registered.");
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
    // The current date in metadata is July 15, 2026, which is before the late registration deadline of 31 October 2026.
    // We will dynamically check this based on local system time.
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
    document.getElementById("cardPaymentSimulator").classList.add("hidden");
    document.getElementById("cashPaymentNotice").classList.add("hidden");
    
    // Show correct simulator
    if (mode === "UPI") {
        document.getElementById("upiPaymentSimulator").classList.remove("hidden");
        startUPITimer(300); // 5 minutes timer
    } else if (mode === "Online") {
        document.getElementById("cardPaymentSimulator").classList.remove("hidden");
    } else if (mode === "Cash") {
        document.getElementById("cashPaymentNotice").classList.remove("hidden");
        isPaymentApproved = true; // Offline doesn't require immediate card/UPI clearance
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
    qrText.innerHTML = "<span style='color: var(--color-success)'>✔ VERIFIED & APPROVED</span>";
}

function verifyCardSimulation() {
    const cardName = document.getElementById("cardNameInput").value;
    const cardNum = document.getElementById("cardNumberInput").value;
    const cardExpiry = document.getElementById("cardExpiryInput").value;
    const cardCvv = document.getElementById("cardCvvInput").value;

    if (!cardName || !cardNum || !cardExpiry || !cardCvv) {
        alert("Please fill all simulated card payment fields.");
        return;
    }

    isPaymentApproved = true;
    alert("Simulated Card transaction authorized successfully!");
}

// ==================== FORM SUBMISSION & RECEIPT GENERATOR ====================
async function handleFormSubmit(event) {
    event.preventDefault();

    // Prevent submission if phone already registered
    const whatsappInput = document.getElementById('whatsappNumber');
    const whatsappError = document.getElementById('whatsappError');
    const phone = whatsappInput?.value?.trim();
    if (!phone) {
        alert('Please enter mobile number');
        return;
    }

    // Final server-side availability check to avoid race conditions.
    // If server is unreachable/500, allow user to proceed; backend will still block duplicates.
    try {
        const res = await fetch(`${API_BASE_URL}/api/students/${phone}`);

        if (res.ok) {
            whatsappAvailable = false;
            if (whatsappInput) whatsappInput.classList.add('invalid');
            if (whatsappError) {
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
            }
            if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
            alert('Mobile number already registered');
            return;
        }

        if (res.status === 404) {
            whatsappAvailable = true;
            if (whatsappInput) {
                whatsappInput.classList.remove('invalid');
                whatsappInput.setCustomValidity('');
            }
            if (whatsappError) {
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
            }
        } else {
            // server error/other status -> don't block
            whatsappAvailable = true;
        }
    } catch (e) {
        // server unreachable -> don't block
        whatsappAvailable = true;
    }


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
    const databaseRegDate = today.toISOString().split('T')[0];

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

    // Create student object in local mock database
    const newStudent = {
        fullName: nameVal,
        class: classVal,
        medium: mediumVal,
        schoolName: schoolVal,
        dob: document.getElementById("dateOfBirth").value,
        parentName: document.getElementById("parentName").value.toUpperCase(),
        whatsapp: document.getElementById("whatsappNumber").value,
        address: resAddr,
        amount: totalAmount,
        payMode: selectedPaymentMode === "Cash" ? "Cash (Offline Pending)" : `${selectedPaymentMode} (Verified)`,
        regNo: regNum,
        status: selectedPaymentMode === "Cash" ? "Pending Payment Approval" : "Approved & Active (Fees Paid)",
        regDate: databaseRegDate,
        formattedRegDate: formattedDate
    };

    try {
        await saveStudentToDatabase(newStudent);
        mockDatabase.save(newStudent);
    } catch (error) {
        console.error("Failed to save registration to database", error);
        const message = error && error.message ? error.message : String(error);
        if (message && message.toLowerCase().includes('mobile')) {
            alert(message);
            // Do not save locally when the mobile number is already registered
            return;
        }
        alert("Could not save registration to database. Please try again later.");
        // Do NOT save locally to avoid showing records that are not persisted in DB
        return;
    }

    // Populate Printable Receipt elements
    document.getElementById("recRegNo").innerText = regNum;
    document.getElementById("recDate").innerText = formattedDate;
    document.getElementById("recStudentName").innerText = nameVal;
    document.getElementById("recSchoolName").innerText = schoolVal;
    document.getElementById("recClass").innerText = `Class ${classVal}`;
    document.getElementById("recMedium").innerText = mediumVal;
    document.getElementById("recAmount").innerText = totalAmount;
    
    if (selectedPaymentMode === "Cash") {
        document.getElementById("recPayMode").innerText = "Cash (Offline)";
        const statusStamp = document.getElementById("recStatus");
        statusStamp.innerText = "PENDING FEE";
        statusStamp.className = "status-stamp pending";
    } else {
        document.getElementById("recPayMode").innerText = `${selectedPaymentMode} (Online Verified)`;
        const statusStamp = document.getElementById("recStatus");
        statusStamp.innerText = "PAID";
        statusStamp.className = "status-stamp approved";
    }
    
    document.getElementById("recAddress").innerText = resAddr;

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

// Attach realtime mobile check after DOM ready (separate listener)
document.addEventListener('DOMContentLoaded', () => {
    const whatsappInput = document.getElementById('whatsappNumber');
    const whatsappError = document.getElementById('whatsappError');
    if (!whatsappInput || !whatsappError) return;

    const check = debounce(async () => {
        const val = whatsappInput.value.trim();
        whatsappAvailable = true;
        whatsappInput.classList.remove('invalid');
        whatsappError.classList.remove('active');
        whatsappError.innerText = '';

        if (!val) return;
        if (!/^\d{10}$/.test(val)) {
            whatsappAvailable = false;
            whatsappInput.classList.add('invalid');
            whatsappError.innerText = 'Please enter a valid 10-digit mobile number.';
            whatsappError.classList.add('active');
            return;
        }

        try {
            // First check the in-memory list we loaded earlier
            const localExists = dbStudents.some(s => String(s.whatsapp || '').trim() === val);
            if (localExists) {
                whatsappAvailable = false;
                whatsappInput.classList.add('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
                return;
            }

            // Fallback: ask server for existence (in case dbStudents not yet loaded)
            const res = await fetch(`${API_BASE_URL}/api/students/${val}`);


            if (res.ok) {
                whatsappAvailable = false;
                whatsappInput.classList.add('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
            } else if (res.status === 404) {
                whatsappAvailable = true;
                whatsappInput.classList.remove('invalid');
                whatsappInput.setCustomValidity('');
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
            } else {
                // Unknown server response: do not claim already registered.
                whatsappAvailable = true;
                whatsappInput.classList.remove('invalid');
                whatsappInput.setCustomValidity('');
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
            }


        } catch (e) {
            // If server check fails, rely on local check result; if local had no match, allow but warn
            const localExistsFallback = dbStudents.some(s => String(s.whatsapp || '').trim() === val);
            if (localExistsFallback) {
                whatsappAvailable = false;
                whatsappInput.classList.add('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
            } else {
                // Network failure but number not in cached DB => allow registration without showing error.
                whatsappAvailable = true;
                whatsappInput.classList.remove('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('');
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
            }

        }

    }, 400);

    const continueBtn = document.getElementById('continueToAddressBtn');

    const check = debounce(async () => {
        const val = whatsappInput.value.trim();
        whatsappAvailable = true;
        whatsappInput.classList.remove('invalid');
        whatsappError.classList.remove('active');
        whatsappError.innerText = '';
        if (continueBtn) continueBtn.disabled = true;

        if (!val) return;
        if (!/^\d{10}$/.test(val)) {
            whatsappAvailable = false;
            whatsappInput.classList.add('invalid');
            whatsappError.innerText = 'Please enter a valid 10-digit mobile number.';
            whatsappError.classList.add('active');
            if (continueBtn) continueBtn.disabled = true;
            return;
        }

        try {
            // First check the in-memory list we loaded earlier
            const localExists = dbStudents.some(s => String(s.whatsapp || '').trim() === val);
            if (localExists) {
                whatsappAvailable = false;
                whatsappInput.classList.add('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
                if (continueBtn) continueBtn.disabled = true;
                return;
            }

            // Fallback: ask server for existence (in case dbStudents not yet loaded)
            const res = await fetch(`${API_BASE_URL}/api/students/${val}`);

            if (res.ok) {
                whatsappAvailable = false;
                whatsappInput.classList.add('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
                if (continueBtn) continueBtn.disabled = true;
            } else if (res.status === 404) {
                whatsappAvailable = true;
                whatsappInput.classList.remove('invalid');
                whatsappInput.setCustomValidity('');
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
                if (continueBtn) continueBtn.disabled = false;
            } else {
                // Unknown server response: do not claim already registered.
                whatsappAvailable = true;
                whatsappInput.classList.remove('invalid');
                whatsappInput.setCustomValidity('');
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
                if (continueBtn) continueBtn.disabled = false;
            }
        } catch (e) {
            // If server check fails, rely on local check result; if local had no match, allow but warn
            const localExistsFallback = dbStudents.some(s => String(s.whatsapp || '').trim() === val);
            if (localExistsFallback) {
                whatsappAvailable = false;
                whatsappInput.classList.add('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('Mobile number already registered');
                whatsappError.innerText = 'Mobile number already registered';
                whatsappError.classList.add('active');
                if (continueBtn) continueBtn.disabled = true;
            } else {
                whatsappAvailable = true;
                whatsappInput.classList.remove('invalid');
                if (whatsappInput) whatsappInput.setCustomValidity('');
                whatsappError.innerText = '';
                whatsappError.classList.remove('active');
                if (continueBtn) continueBtn.disabled = false;
            }
        }

    }, 400);

    whatsappInput.addEventListener('input', check);
    whatsappInput.addEventListener('blur', check);

    // initialize Continue button state
    if (continueBtn) continueBtn.disabled = true;
});


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
    document.getElementById("cardPaymentSimulator").classList.add("hidden");
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
    const loginPass = document.getElementById("loginPass").value.trim(); // DOB in format DDMMYYYY (e.g. 15082012)

    // Normalize digits-only form for comparison (accepts inputs with separators)
    const loginPassDigits = (loginPass || "").replace(/\D/g, "");

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
            const res = await fetch(`${API_BASE_URL}/api/students`);
            if (res.ok) {
                const all = await res.json();
                const matched = (all || []).find(s => ((s.reg_no || s.regNo || "").toString().toUpperCase() === loginUser) || ((s.whatsapp || "").toString() === loginUser));
                if (matched) {
                    const serverDob = matched.dob || matched.DOB || matched.reg_date || matched.regDate;
                    const storedIso = getDobIsoFormat(serverDob);
                    const loginIso = getDobIsoFormat(loginPass);
                    if (storedIso && loginIso && storedIso === loginIso) {
                        // Normalize keys and consider user authenticated
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
                        // Save to local mock cache for subsequent actions
                        try { mockDatabase.save(foundStudent); } catch (e) { /* ignore storage errors */ }
                    } else {
                        // set existUser for helpful message later
                        existUser = {
                            fullName: matched.full_name || matched.fullName,
                            dob: serverDob
                        };
                    }
                }
            }
        } catch (e) {
            console.warn('Server auth lookup failed', e && e.message ? e.message : e);
        }
    }

    if (foundStudent) {
        activeStudentSession = foundStudent;
        showDashboardView(foundStudent);
    } else {
        // Find if user exists but password mismatch, to give a helpful alert
        let existUser = mockDatabase.students.find(s => (s.regNo || "").toString().toUpperCase() === loginUser || (s.whatsapp || "").toString() === loginUser);
        // If local cache doesn't have the user (tracking prevention or failed initial load), try the server
        if (!existUser) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/students`);
                if (res.ok) {
                    const all = await res.json();
                    existUser = (all || []).find(s => ((s.reg_no || s.regNo || "").toString().toUpperCase() === loginUser) || ((s.whatsapp || "").toString() === loginUser));
                    if (existUser) {
                        // normalize server keys to match client expectations
                        existUser.fullName = existUser.full_name || existUser.fullName;
                        existUser.regNo = existUser.reg_no || existUser.regNo;
                        existUser.dob = existUser.dob || existUser.DOB || existUser.reg_date || existUser.regDate;
                    }
                }
            } catch (e) {
                console.warn('Server lookup failed', e.message || e);
            }
        }

        if (existUser) {
            const expectedDob = getDobPasswordFormat(existUser.dob);
            // Debug info to help diagnose mismatches
            const debugMsg = `expectedDob=${expectedDob} storedDob=${existUser.dob} entered=${loginPass} expectedDigits=${(expectedDob||"").replace(/\D/g, "")} enteredDigits=${loginPassDigits}`;
            console.debug("Login failed:", debugMsg);
            const dbg = document.getElementById('loginDebug');
            const dbgText = document.getElementById('loginDebugText');
            if (dbg && dbgText) {
                dbgText.innerText = debugMsg;
                dbg.style.display = 'block';
            }
            alert(`Password incorrect for ${existUser.fullName}. Please enter DOB in DDMMYYYY format (e.g. ${expectedDob}).`);
        } else {
            alert("No registered student found with this Registration ID or Mobile Number. Please complete the application form first!");
        }
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
    statusTxt.innerText = student.status;
    
    if (student.status.includes("Paid") || student.status.includes("Active")) {
        statusDot.className = "status-dot green";
    } else {
        statusDot.className = "status-dot yellow";
    }

    // Countdown calculations (Exam: 14 Feb 2027)
    const examDate = new Date(2027, 1, 14); // 14 February 2027
    const today = new Date();
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

    lucide.createIcons();
}

function handleDashboardLogout() {
    activeStudentSession = null;
    document.getElementById("imtseLoginForm").reset();
    
    document.getElementById("student-dashboard").classList.add("hidden");
    document.getElementById("login-form-box").classList.remove("hidden");
    
    switchTab("home");
}

function populateAdminCategoryOptions() {
    const categorySelect = document.getElementById("resourceCategory");
    if (!categorySelect) return;
    categorySelect.innerHTML = adminCategories.map(category => `<option value="${category.value}">${category.label}</option>`).join("");
}

function renderAdminStudents() {
    const tableBody = document.getElementById("adminStudentsTable");
    if (!tableBody) return;
    tableBody.innerHTML = dbStudents.map(student => {
        const studentId = student.regNo || student.whatsapp;
        return `
            <tr>
                <td>${student.fullName}</td>
                <td>${student.class}</td>
                <td>${student.whatsapp}</td>
                <td>${student.status}</td>
                <td>
                    <button class="btn-secondary" type="button" onclick="editStudentFromAdmin('${studentId}')">Edit</button>
                    <button class="btn-secondary" type="button" onclick="deleteStudentFromAdmin('${studentId}')">Remove</button>
                </td>
            </tr>
        `;
    }).join("");
}

function renderAdminResources() {
    const tableBody = document.getElementById("adminResourcesTable");
    if (!tableBody) return;
    tableBody.innerHTML = dbResources.map(resource => `
        <tr>
            <td>${resource.title}</td>
            <td>${adminCategories.find(cat => cat.value === resource.category)?.label || resource.category}</td>
            <td>${resource.type}</td>
            <td><a href="${resource.url}" target="_blank" rel="noreferrer">Open</a></td>
            <td>
                <button class="btn-secondary" type="button" onclick="editResourceFromAdmin(${resource.id})">Edit</button>
                <button class="btn-secondary" type="button" onclick="deleteResourceFromAdmin(${resource.id})">Remove</button>
            </td>
        </tr>
    `).join("");
}

function renderStudentResources() {
    const container = document.getElementById("studentResourcesList");
    if (!container) return;
    const resourcesMarkup = dbResources.map(resource => `
        <a href="${resource.url}" target="_blank" rel="noreferrer" class="download-item">
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
        regDate: document.getElementById("adminStudentRegDate").value || new Date().toISOString().split('T')[0]
    };

    try {
        if (studentId) {
            await saveStudentToDatabase(studentData, studentId);
        } else {
            // Pre-check phone availability before attempting to save
            const phone = String(studentData.whatsapp || '').trim();
            if (phone) {
                // check local cache first
                const localExists = dbStudents.some(s => String(s.whatsapp || '').trim() === phone);
                if (localExists) {
                    alert('Mobile number already registered.');
                    return;
                }
                try {
                    const checkRes = await fetch(`${API_BASE_URL}/api/students/${encodeURIComponent(phone)}`);
                    if (checkRes.ok) {
                        alert('Mobile number already registered.');
                        return;
                    } else if (checkRes.status !== 404) {
                        alert('Could not verify mobile number availability. Try again later.');
                        return;
                    }
                } catch (e) {
                    // fallback to local result (which was negative), allow continue
                }
            }

            await saveStudentToDatabase(studentData);
        }

        await loadStudentsFromDatabase();
        form.reset();
        resetAdminStudentForm();
        alert("Student profile saved successfully.");
    } catch (error) {
        console.error("Failed to save student to database", error);
        const message = error && error.message ? error.message : String(error);
        if (message && message.toLowerCase().includes('mobile')) {
            alert(message);
            return;
        }
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
            const message = error && error.message ? error.message : String(error);
            if (message && (message.toLowerCase().includes('not found') || message.toLowerCase().includes('404'))) {
                alert("Student record was not found in the database.");
                return;
            }
            alert("Could not remove the student from the database.");
        }
    }
}

async function saveResourceFromAdmin(event) {
    event.preventDefault();
    const resourceId = document.getElementById("adminResourceId").value;
    const resourceType = document.getElementById("resourceType").value;
    const fileInput = document.getElementById("resourceFile");
    const resourceData = {
        id: resourceId ? Number(resourceId) : Date.now(),
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

    if (resourceId) {
        mockDatabase.updateResource(resourceData);
    } else {
        mockDatabase.saveResource(resourceData);
    }

    resetAdminResourceForm();
    renderAdminResources();
    renderStudentResources();
    alert("Resource saved successfully.");
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

function deleteResourceFromAdmin(resourceId) {
    if (confirm("Remove this study resource?")) {
        mockDatabase.deleteResource(resourceId);
        renderAdminResources();
        renderStudentResources();
        alert("Resource removed.");
    }
}
