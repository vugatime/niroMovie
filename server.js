// niroMovie API server — deploy v1 (Render)
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

const app = express();

// Allow requests from your Vercel frontend (and local dev)
app.use(cors({
  origin: ['https://niro-movie.vercel.app', 'https://niromovie.site', 'https://www.niromovie.site', 'http://localhost:3000']
}));
app.use(express.json({ limit: '200mb' }));

// Create temp folders (still needed for multer before Cloudinary upload)
['uploads', 'uploads/videos', 'uploads/thumbnails', 'uploads/trailers', 'uploads/ads', 'uploads/payments'].forEach(folder => {
    const dir = path.join(__dirname, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected - niroMovie API v1 - ' + new Date().toISOString()))
    .catch(err => console.log('MongoDB Error:', err));

// Cloudinary Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ========== MODELS ==========
const DeviceSchema = new mongoose.Schema({
    deviceId: String, deviceName: String, ipAddress: String,
    lastLogin: { type: Date, default: Date.now }, loginCount: { type: Number, default: 1 }
});

const ViewRecordSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deviceId: String, viewedAt: { type: Date, default: Date.now }
});

const DownloadRecordSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deviceId: String, partIndex: Number, seasonIndex: Number, episodeIndex: Number,
    downloadedAt: { type: Date, default: Date.now }
});

const NotificationSchema = new mongoose.Schema({
    message: String, type: { type: String, enum: ['subscription', 'system', 'warning', 'success'], default: 'system' },
    read: { type: Boolean, default: false }, createdAt: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: { type: String, default: '' },
    phone: { type: String, default: '' },
    role: { type: String, enum: ['user', 'content_creator', 'admin'], default: 'user' },
    adminLevel: { type: String, enum: ['head', 'sub', 'content'], default: null },
    isEmailVerified: { type: Boolean, default: true },
    subscription: {
        plan: { type: String, enum: ['free', 'basic', 'standard', 'premium', 'ultimate'], default: 'free' },
        duration: { type: String, enum: ['weekly', 'monthly', 'quarterly', 'yearly', 'none'], default: 'none' },
        expiresAt: { type: Date, default: null }, startDate: { type: Date, default: null },
        status: { type: String, enum: ['active', 'pending', 'expired', 'flagged', 'none'], default: 'none' },
        maxDevices: { type: Number, default: 6 }, approvedBy: String, approvedAt: Date
    },
    devices: [DeviceSchema], deviceCount: { type: Number, default: 0 },
    isFlagged: { type: Boolean, default: false }, flagReason: String,
    notifications: [NotificationSchema],
    myList: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Content' }],
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const PartSchema = new mongoose.Schema({
    partNumber: String, title: String, videoUrl: String,
    videoSource: { type: String, enum: ['upload', 'external', 'pixeldrain'], default: 'external' },
    accessLevel: { type: String, enum: ['free', 'basic', 'standard', 'premium', 'ultimate'], default: 'free' },
    views: { type: Number, default: 0 }, downloads: { type: Number, default: 0 }
});

const EpisodeSchema = new mongoose.Schema({
    episodeNumber: Number, title: String, description: String, videoUrl: String,
    videoSource: { type: String, enum: ['upload', 'external', 'pixeldrain'], default: 'external' },
    accessLevel: { type: String, enum: ['free', 'basic', 'standard', 'premium', 'ultimate'], default: 'free' },
    views: { type: Number, default: 0 }, downloads: { type: Number, default: 0 }
});

const SeasonSchema = new mongoose.Schema({
    seasonNumber: Number, title: String, episodes: [EpisodeSchema]
});

const ContentSchema = new mongoose.Schema({
    type: { type: String, enum: ['movie', 'series'], required: true },
    title: String, description: String, descriptionHTML: String, synopsis: String,
    category: { type: String, required: true },
    year: String, runtime: String, director: String, cast: String,
    translator: { type: String, default: 'Not translated' },
    language: { type: String, default: 'English' },
    country: { type: String, default: 'Rwanda' },
    thumbnailUrl: String, trailerUrl: String,
    accessLevel: { type: String, enum: ['free', 'basic', 'standard', 'premium', 'ultimate'], default: 'free' },
    quality: { type: String, enum: ['480p', '720p', '1080p', '2K', '4K'], default: '720p' },
    isTrending: { type: Boolean, default: false }, isLatest: { type: Boolean, default: false }, isFeatured: { type: Boolean, default: false },
    ageRating: { type: String, default: '13+' }, rating: { type: Number, default: 0 },
    views: { type: Number, default: 0 }, downloads: { type: Number, default: 0 },
    viewedBy: [ViewRecordSchema], downloadedBy: [DownloadRecordSchema],
    parts: [PartSchema], seasons: [SeasonSchema],
    comments: [{
        userName: String, text: String,
        likes: { type: Number, default: 0 },
        likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        likedByDevice: [String],
        createdAt: { type: Date, default: Date.now }
    }],
    tags: [String], uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, uploadedByEmail: String,
    uploadedAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
});
const Content = mongoose.model('Content', ContentSchema);

const TransactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, userEmail: String, userFullName: String,
    phone: String, amount: Number, currency: { type: String, default: 'RWF' },
    plan: String, duration: String, paymentMethod: { type: String, default: 'momo' },
    screenshotUrl: String, senderName: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'archived'], default: 'pending' },
    adminNote: String, processedBy: String, createdAt: { type: Date, default: Date.now }, processedAt: Date
});
const Transaction = mongoose.model('Transaction', TransactionSchema);

const WithdrawalSchema = new mongoose.Schema({
    amount: Number, bankDetails: { bankName: String, accountNumber: String, accountName: String },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, requestedByEmail: String, requestedByName: String,
    status: { type: String, enum: ['pending', 'approved', 'completed', 'rejected'], default: 'pending' },
    processedBy: String, processedByEmail: String, adminNote: String,
    createdAt: { type: Date, default: Date.now }, completedAt: Date
});
const Withdrawal = mongoose.model('Withdrawal', WithdrawalSchema);

const AdSchema = new mongoose.Schema({
    type: { type: String, enum: ['image', 'video', 'text'], required: true },
    title: String, description: String, mediaUrl: String, link: String,
    contactPhone: String, contactName: String, contactEmail: String, businessName: String,
    position: { type: String, enum: ['top', 'sidebar', 'between', 'footer'], default: 'sidebar' },
    isActive: { type: Boolean, default: true }, targetPlans: [String],
    impressions: { type: Number, default: 0 }, clicks: { type: Number, default: 0 },
    startDate: Date, endDate: Date, textSpeed: { type: String, default: 'normal' },
    createdBy: String, createdAt: { type: Date, default: Date.now }, updatedAt: { type: Date, default: Date.now }
});
const Ad = mongoose.model('Ad', AdSchema);

const AnnouncementSchema = new mongoose.Schema({
    title: String, message: String, mediaUrl: String,
    mediaType: { type: String, enum: ['text', 'image', 'video'], default: 'text' },
    isActive: { type: Boolean, default: true },
    createdBy: String, createdAt: { type: Date, default: Date.now }
});
const Announcement = mongoose.model('Announcement', AnnouncementSchema);

// ========== MULTER WITH CLOUDINARY ==========
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'thumbnail') cb(null, path.join(__dirname, 'uploads/thumbnails/'));
        else if (file.fieldname === 'trailer') cb(null, path.join(__dirname, 'uploads/trailers/'));
        else if (file.fieldname === 'adMedia') cb(null, path.join(__dirname, 'uploads/ads/'));
        else if (file.fieldname === 'paymentScreenshot') cb(null, path.join(__dirname, 'uploads/payments/'));
        else if (file.fieldname === 'announcementMedia') cb(null, path.join(__dirname, 'uploads/'));
        else cb(null, path.join(__dirname, 'uploads/videos/'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
    }
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

async function uploadToCloudinary(file, folder, resourceType = 'image') {
    try {
        const result = await cloudinary.uploader.upload(file.path, {
            folder: 'niromovie/' + folder,
            resource_type: resourceType
        });
        fs.unlink(file.path, () => {});
        return result.secure_url;
    } catch (err) {
        console.log('Cloudinary upload error:', err.message);
        return '/' + file.path.replace(__dirname, '').replace(/\\/g, '/');
    }
}

// ========== MIDDLEWARE ==========
const authMiddleware = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Access denied. Please login to continue.' });
    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(verified.id);
        if (!user) return res.status(401).json({ error: 'User not found. Please login again.' });
        if (user.subscription.status === 'active' && user.subscription.expiresAt && new Date() > new Date(user.subscription.expiresAt)) {
            user.subscription.status = 'expired'; user.subscription.plan = 'free'; user.subscription.duration = 'none';
            user.notifications.push({ message: 'Your subscription has expired. Renew to regain access.', type: 'warning' });
            await user.save();
        }
        const deviceId = req.header('X-Device-ID') || 'unknown';
        const existingDevice = user.devices.find(d => d.deviceId === deviceId);
        if (existingDevice) { existingDevice.lastLogin = new Date(); existingDevice.loginCount += 1; }
        else {
            if (user.role !== 'admin' && user.subscription.plan !== 'free' && user.devices.length >= user.subscription.maxDevices) {
                user.isFlagged = true; user.flagReason = 'Device limit exceeded (' + user.subscription.maxDevices + ' devices). Contact admin.';
                await user.save();
                return res.status(403).json({ error: 'Device limit reached! Your account has been flagged.', flagged: true });
            }
            user.devices.push({ deviceId, deviceName: req.header('X-Device-Name') || 'Unknown', ipAddress: req.ip, lastLogin: new Date() });
            user.deviceCount = user.devices.length;
        }
        await user.save(); req.user = user; next();
    } catch (err) { res.status(401).json({ error: 'Invalid session. Please login again.' }); }
};

const adminMiddleware = (req, res, next) => {
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'content_creator')) return res.status(403).json({ error: 'Admin access only.' });
    next();
};

const headAdminMiddleware = (req, res, next) => {
    if (!req.user || req.user.adminLevel !== 'head') return res.status(403).json({ error: 'Only Head Admin can perform this action.' });
    next();
};

const subAdminOrAbove = (req, res, next) => {
    if (!req.user || (req.user.adminLevel !== 'head' && req.user.adminLevel !== 'sub')) return res.status(403).json({ error: 'Access denied.' });
    next();
};

const checkAccessLevel = (userPlan, contentAccessLevel) => {
    const planLevels = { free: 0, basic: 1, standard: 2, premium: 3, ultimate: 4 };
    return (planLevels[userPlan] || 0) >= (planLevels[contentAccessLevel] || 0);
};

function getStreamUrl(url) { if (!url) return ''; return url; }
function getDownloadUrl(url) { if (!url) return ''; return url; }
function canStream(url) { if (!url) return false; return url.includes('pixeldrain.com') || url.includes('youtube.com') || url.includes('vimeo.com') || url.includes('mega.nz'); }

// ========== CREATE ADMINS ==========
async function createAdmins() {
    const admins = [
        { email: 'agasobanuyenews@gmail.com', password: 'Joselove@250', fullName: 'Nirobwimba - Head Admin & CEO', adminLevel: 'head' },
        { email: 'vugatime@gmail.com', password: 'vugatime@123', fullName: 'Vugatime Media - Sub Admin', adminLevel: 'sub' },
        { email: 'niromusicvibes@gmail.com', password: 'niromusicvibes@123', fullName: 'Content Creator', adminLevel: 'content' }
    ];
    for (const admin of admins) {
        const existing = await User.findOne({ email: admin.email });
        if (!existing) {
            await User.create({
                email: admin.email, password: await bcrypt.hash(admin.password, 10), fullName: admin.fullName, role: 'admin', adminLevel: admin.adminLevel,
                isEmailVerified: true,
                subscription: { plan: 'ultimate', duration: 'yearly', expiresAt: new Date('2030-12-31'), startDate: new Date(), status: 'active', maxDevices: 100 }
            });
            console.log('Admin created: ' + admin.email);
        } else if (!existing.adminLevel) {
            existing.adminLevel = admin.adminLevel;
            existing.fullName = admin.fullName;
            await existing.save();
            console.log('Admin updated: ' + admin.email);
        }
    }
}

// ========== AUTH ROUTES ==========
app.post('/api/register', async (req, res) => {
    try {
        const { email, password, fullName, phone } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required!' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters!' });
        if (await User.findOne({ email })) return res.status(400).json({ error: 'Email already registered!' });
        const user = await User.create({
            email, password: await bcrypt.hash(password, 10), fullName: fullName || 'Movie Lover', phone: phone || '',
            isEmailVerified: true,
            subscription: { plan: 'free', duration: 'none', startDate: new Date(), status: 'active', maxDevices: 6 },
            notifications: [{ message: 'Welcome to NIROMOVIE!', type: 'system' }]
        });
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET);
        res.status(201).json({ token, user: { id: user._id, email, role: user.role, fullName: user.fullName, subscription: user.subscription, isEmailVerified: true }, message: 'Account created! Welcome!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required!' });
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: 'No account found with this email.' });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: 'Incorrect password.' });
        if (user.isFlagged && user.role !== 'admin') return res.status(403).json({ error: 'Account under review: ' + user.flagReason, flagged: true });
        if (user.subscription.status === 'active' && user.subscription.expiresAt && new Date() > new Date(user.subscription.expiresAt)) {
            user.subscription.status = 'expired'; user.subscription.plan = 'free'; user.subscription.duration = 'none';
            user.devices = []; user.deviceCount = 0; user.isFlagged = false;
            user.notifications.push({ message: 'Your subscription has expired.', type: 'warning' });
            await user.save();
        }
        const deviceId = req.header('X-Device-ID') || crypto.randomBytes(16).toString('hex');
        const existingDevice = user.devices.find(d => d.deviceId === deviceId);
        if (existingDevice) { existingDevice.lastLogin = new Date(); existingDevice.loginCount += 1; }
        else {
            if (user.role !== 'admin' && user.subscription.plan !== 'free' && user.devices.length >= user.subscription.maxDevices) {
                user.isFlagged = true; user.flagReason = 'Device limit exceeded (' + user.subscription.maxDevices + ' devices).';
                await user.save();
                return res.status(403).json({ error: 'Maximum devices reached! Contact admin: +250 795 064 502', flagged: true });
            }
            user.devices.push({ deviceId, deviceName: req.header('X-Device-Name') || 'Unknown', ipAddress: req.ip, lastLogin: new Date() });
            user.deviceCount = user.devices.length;
        }
        await user.save();
        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET);
        let expiringSoon = false;
        if (user.subscription.status === 'active' && user.subscription.expiresAt) {
            const daysLeft = Math.ceil((new Date(user.subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            expiringSoon = daysLeft <= 2;
        }
        res.json({ token, user: { id: user._id, email: user.email, role: user.role, adminLevel: user.adminLevel, fullName: user.fullName, subscription: user.subscription, deviceCount: user.deviceCount, isEmailVerified: true }, expiringSoon, message: expiringSoon ? 'Subscription expiring soon!' : 'Welcome back!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/me', authMiddleware, async (req, res) => {
    const user = await User.findById(req.user.id).select('-password');
    let expiryAlert = null;
    if (user.subscription.status === 'active' && user.subscription.expiresAt) {
        const daysLeft = Math.ceil((new Date(user.subscription.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 2 && daysLeft > 0) expiryAlert = 'Your ' + user.subscription.plan.toUpperCase() + ' plan expires in ' + daysLeft + ' day(s)!';
        else if (daysLeft <= 0) expiryAlert = 'Subscription expired. You are now on Free plan.';
    }
    const unreadNotifications = (user.notifications || []).filter(n => !n.read).length;
    res.json({ ...user.toObject(), expiryAlert, unreadNotifications });
});

app.get('/api/notifications', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id); res.json(user.notifications || []); });
app.put('/api/notifications/read', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id); user.notifications.forEach(n => n.read = true); await user.save(); res.json({ success: true }); });

// ========== ANNOUNCEMENTS ==========
app.get('/api/announcements', async (req, res) => { res.json(await Announcement.find({ isActive: true }).sort({ createdAt: -1 }).limit(1)); });
app.get('/api/admin/announcements', authMiddleware, adminMiddleware, async (req, res) => { res.json(await Announcement.find().sort({ createdAt: -1 })); });
app.post('/api/admin/announcements', authMiddleware, subAdminOrAbove, upload.single('announcementMedia'), async (req, res) => {
    try {
        const { title, message, mediaType } = req.body;
        let mediaUrl = '';
        if (req.file) { mediaUrl = await uploadToCloudinary(req.file, 'announcements', mediaType === 'video' ? 'video' : 'image'); }
        const announcement = await Announcement.create({ title, message: message || '', mediaUrl, mediaType: mediaType || 'text', createdBy: req.user.email });
        res.json({ success: true, announcement });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/admin/announcements/:id', authMiddleware, subAdminOrAbove, async (req, res) => { await Announcement.findByIdAndUpdate(req.params.id, req.body); res.json({ success: true }); });
app.delete('/api/admin/announcements/:id', authMiddleware, headAdminMiddleware, async (req, res) => { await Announcement.findByIdAndDelete(req.params.id); res.json({ success: true }); });

// ========== CONTENT ROUTES ==========
app.get('/api/contents', async (req, res) => {
    try {
        const { category, type, search } = req.query;
        let query = {};
        if (category) query.category = category;
        if (type) query.type = type;
        if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
        const contents = await Content.find(query).select('-parts.videoUrl -seasons.episodes.videoUrl').sort({ uploadedAt: -1 });
        res.json(contents);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contents/:id', async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) return res.status(404).json({ error: 'Content not found!' });
        const userId = req.user?.id || null; const deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
        let alreadyViewed = false;
        if (userId) { alreadyViewed = content.viewedBy && content.viewedBy.some(v => v.userId && v.userId.toString() === userId.toString()); }
        else { alreadyViewed = content.viewedBy && content.viewedBy.some(v => v.deviceId === deviceId); }
        if (!alreadyViewed) {
            content.views = (content.views || 0) + 1;
            if (!content.viewedBy) content.viewedBy = [];
            content.viewedBy.push({ userId: userId, deviceId: deviceId, viewedAt: new Date() });
            await content.save();
        }
        const related = await Content.find({ _id: { $ne: content._id }, category: content.category }).limit(12).select('-parts.videoUrl');
        res.json({ content, related });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contents/:id/stream', async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) return res.status(404).json({ error: 'Content not found' });
        const partIndex = parseInt(req.query.part) || 0; const seasonIndex = parseInt(req.query.season) || 0; const episodeIndex = parseInt(req.query.episode) || 0;
        let videoUrl = '';
        if (content.type === 'movie' && content.parts && content.parts.length > partIndex) { videoUrl = content.parts[partIndex].videoUrl; }
        else if (content.type === 'series' && content.seasons && content.seasons[seasonIndex] && content.seasons[seasonIndex].episodes && content.seasons[seasonIndex].episodes[episodeIndex]) { videoUrl = content.seasons[seasonIndex].episodes[episodeIndex].videoUrl; }
        if (!videoUrl) return res.status(404).json({ error: 'No video URL found' });
        const streamUrl = getStreamUrl(videoUrl);
        const userId = req.user?.id || null; const deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
        let alreadyViewed = content.viewedBy && content.viewedBy.some(v => (userId && v.userId && v.userId.toString() === userId.toString()) || (!userId && v.deviceId === deviceId));
        if (!alreadyViewed) { content.views = (content.views || 0) + 1; if (!content.viewedBy) content.viewedBy = []; content.viewedBy.push({ userId, deviceId, viewedAt: new Date() }); await content.save(); }
        res.json({ streamUrl, canStream: canStream(videoUrl), title: content.title, quality: content.quality });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contents/:id/download', async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) return res.status(404).json({ error: 'Content not found' });
        const partIndex = parseInt(req.body?.part) || 0; const seasonIndex = parseInt(req.body?.season) || 0; const episodeIndex = parseInt(req.body?.episode) || 0;
        let videoUrl = ''; let itemAccessLevel = 'free';
        if (content.type === 'movie' && content.parts && content.parts.length > partIndex) { videoUrl = content.parts[partIndex].videoUrl; itemAccessLevel = content.parts[partIndex].accessLevel || content.accessLevel || 'free'; }
        else if (content.type === 'series' && content.seasons && content.seasons[seasonIndex] && content.seasons[seasonIndex].episodes && content.seasons[seasonIndex].episodes[episodeIndex]) { videoUrl = content.seasons[seasonIndex].episodes[episodeIndex].videoUrl; itemAccessLevel = content.seasons[seasonIndex].episodes[episodeIndex].accessLevel || content.accessLevel || 'free'; }
        else if (content.parts?.[0]?.videoUrl) { videoUrl = content.parts[0].videoUrl; }
        else if (content.seasons?.[0]?.episodes?.[0]?.videoUrl) { videoUrl = content.seasons[0].episodes[0].videoUrl; }
        if (!videoUrl) return res.status(404).json({ error: 'No video available for download' });
        if (itemAccessLevel !== 'free') {
            const token = req.header('Authorization')?.replace('Bearer ', '');
            if (!token) return res.status(401).json({ error: 'Login required for premium content.' });
            try {
                const verified = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(verified.id);
                if (!user) return res.status(401).json({ error: 'User not found.' });
                const userPlan = user.subscription.plan || 'free'; const userStatus = user.subscription.status || 'none';
                if (userStatus !== 'active') return res.status(403).json({ error: 'Your subscription is pending approval.' });
                if (!checkAccessLevel(userPlan, itemAccessLevel)) return res.status(403).json({ error: 'Subscribe to ' + itemAccessLevel.toUpperCase() + ' plan to download!' });
            } catch (err) { return res.status(401).json({ error: 'Please login to download premium content.' }); }
        }
        const downloadUrl = getDownloadUrl(videoUrl);
        const userId = req.user?.id || null; const deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
        let alreadyDownloaded = content.downloadedBy && content.downloadedBy.some(d => (userId && d.userId && d.userId.toString() === userId.toString()) || (!userId && d.deviceId === deviceId));
        if (!alreadyDownloaded) { content.downloads = (content.downloads || 0) + 1; if (!content.downloadedBy) content.downloadedBy = []; content.downloadedBy.push({ userId, deviceId, partIndex, seasonIndex, episodeIndex, downloadedAt: new Date() }); await content.save(); }
        res.json({ downloadUrl, quality: content.quality, title: content.title, canStream: canStream(videoUrl) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contents/:id/parts', async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) return res.status(404).json({ error: 'Content not found' });
        let items = [];
        if (content.type === 'movie' && content.parts) {
            items = content.parts.map((p, i) => ({ index: i, type: 'part', number: p.partNumber || String(i + 1), title: p.title || 'Part ' + (i + 1), videoUrl: p.videoUrl, videoSource: p.videoSource, accessLevel: p.accessLevel || 'free', streamUrl: getStreamUrl(p.videoUrl), downloadUrl: getDownloadUrl(p.videoUrl), canStream: canStream(p.videoUrl) }));
        } else if (content.type === 'series' && content.seasons) {
            content.seasons.forEach(function(season, si) {
                if (season.episodes) {
                    season.episodes.forEach(function(ep, ei) {
                        items.push({ index: items.length, type: 'episode', seasonIndex: si, episodeIndex: ei, number: 'S' + season.seasonNumber + ' E' + ep.episodeNumber, title: ep.title || 'Episode ' + ep.episodeNumber, seasonTitle: season.title || 'Season ' + season.seasonNumber, videoUrl: ep.videoUrl, videoSource: ep.videoSource, accessLevel: ep.accessLevel || 'free', streamUrl: getStreamUrl(ep.videoUrl), downloadUrl: getDownloadUrl(ep.videoUrl), canStream: canStream(ep.videoUrl) });
                    });
                }
            });
        }
        res.json({ contentTitle: content.title, contentType: content.type, accessLevel: content.accessLevel, thumbnailUrl: content.thumbnailUrl, items: items, totalItems: items.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== COMMENTS ==========
app.get('/api/comments/:contentId', async (req, res) => { const content = await Content.findById(req.params.contentId); if (!content) return res.status(404).json({ error: 'Not found' }); res.json((content.comments || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); });
app.post('/api/comments/:contentId', async (req, res) => { const { userName, text } = req.body; if (!userName || !text) return res.status(400).json({ error: 'Name and comment required' }); const content = await Content.findById(req.params.contentId); if (!content) return res.status(404).json({ error: 'Not found' }); content.comments.push({ userName: userName.trim(), text: text.trim() }); await content.save(); res.json({ success: true }); });
app.post('/api/comments/:contentId/:commentId/like', async (req, res) => {
    try {
        const content = await Content.findById(req.params.contentId);
        const comment = content?.comments.id(req.params.commentId);
        if (!comment) return res.status(404).json({ error: 'Not found' });
        const userId = req.user?.id || null; const deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
        if (!comment.likedBy) comment.likedBy = [];
        if (!comment.likedByDevice) comment.likedByDevice = [];
        let alreadyLiked = false;
        if (userId) { alreadyLiked = comment.likedBy.some(id => id.toString() === userId.toString()); }
        else { alreadyLiked = comment.likedByDevice.includes(deviceId); }
        if (alreadyLiked) return res.status(400).json({ error: 'You already liked this comment.' });
        comment.likes = (comment.likes || 0) + 1;
        if (userId) comment.likedBy.push(userId);
        comment.likedByDevice.push(deviceId);
        await content.save();
        res.json({ likes: comment.likes });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== PLANS ==========
app.get('/api/plans', (req, res) => { res.json({ free: { name: 'Free', weekly: 0, monthly: 0, quarterly: 0, yearly: 0, features: ['Free movies', 'Ads', '480p'] }, basic: { name: 'Basic', weekly: 300, monthly: 500, quarterly: 1200, yearly: 3000, features: ['Free+Basic', 'Fewer ads', '720p', 'Download'] }, standard: { name: 'Standard', weekly: 500, monthly: 1000, quarterly: 2500, yearly: 7000, features: ['Most movies', 'Very few ads', '1080p', 'HD Download'] }, premium: { name: 'Premium', weekly: 1000, monthly: 2000, quarterly: 5000, yearly: 15000, features: ['Almost all', 'Almost no ads', '2K'] }, ultimate: { name: 'Ultimate', weekly: 2000, monthly: 5000, quarterly: 12000, yearly: 30000, features: ['ALL movies', 'NO ADS', '4K', 'VIP'] } }); });

// ========== SUBSCRIBE ==========
app.post('/api/subscribe', authMiddleware, upload.single('paymentScreenshot'), async (req, res) => {
    try {
        const { plan, duration, phone, senderName, paymentMethod } = req.body;
        const plans = { basic: { weekly: 300, monthly: 500, quarterly: 1200, yearly: 3000 }, standard: { weekly: 500, monthly: 1000, quarterly: 2500, yearly: 7000 }, premium: { weekly: 1000, monthly: 2000, quarterly: 5000, yearly: 15000 }, ultimate: { weekly: 2000, monthly: 5000, quarterly: 12000, yearly: 30000 } };
        if (!plans[plan]?.[duration]) return res.status(400).json({ error: 'Invalid plan' });
        if (!phone || !senderName) return res.status(400).json({ error: 'Phone and name required' });
        if (!req.file) return res.status(400).json({ error: 'Payment screenshot is required!' });
        const user = await User.findById(req.user.id);
        const screenshotUrl = await uploadToCloudinary(req.file, 'payments');
        const txn = await Transaction.create({ userId: req.user._id, userEmail: req.user.email, userFullName: req.user.fullName, phone, amount: plans[plan][duration], plan, duration, paymentMethod: paymentMethod || 'momo', screenshotUrl, senderName, status: 'pending' });
        await User.findByIdAndUpdate(req.user._id, { 'subscription.status': 'pending', 'subscription.plan': plan, 'subscription.duration': duration });
        user.notifications.push({ message: 'Payment submitted! Waiting for admin approval.', type: 'subscription' });
        await user.save();
        res.json({ success: true, message: 'Payment submitted! Admin will verify within 24 hours.', transaction: txn });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== ADMIN ROUTES ==========
app.get('/api/admin/me', authMiddleware, adminMiddleware, async (req, res) => { const user = await User.findById(req.user.id).select('-password'); res.json({ ...user.toObject(), isHeadAdmin: user.adminLevel === 'head' }); });

app.post('/api/admin/upload', authMiddleware, adminMiddleware, upload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'trailer', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res) => {
    try {
        const { type, title, description, category, year, director, cast, translator, language, country, accessLevel, quality, ageRating, tags, isFeatured, isTrending, videoSource, externalLink, seasonNumber, episodeNumber, episodeTitle, partAccessLevel } = req.body;
        if (!req.files?.thumbnail?.[0]) return res.status(400).json({ error: 'Thumbnail required!' });
        if (!title || !description || !category || !year) return res.status(400).json({ error: 'Title, Description, Category, Year required!' });
        const thumbnailUrl = await uploadToCloudinary(req.files.thumbnail[0], 'thumbnails');
        const trailerUrl = req.files.trailer?.[0] ? await uploadToCloudinary(req.files.trailer[0], 'trailers', 'video') : '';
        const data = { type: type || 'movie', title, description, category, year, director: director || '', cast: cast || '', translator: translator || 'Not translated', language: language || 'English', country: country || 'Rwanda', thumbnailUrl, trailerUrl, accessLevel: accessLevel || 'free', quality: quality || '720p', ageRating: ageRating || '13+', tags: tags ? tags.split(',').map(t => t.trim()) : [], isFeatured: isFeatured === 'true', isTrending: isTrending === 'true', isLatest: true, uploadedBy: req.user._id, uploadedByEmail: req.user.email };
        let videoUrl = '', videoSrc = videoSource || 'external';
        if (videoSrc === 'external' && externalLink?.trim()) videoUrl = externalLink.trim();
        else if (req.files?.video?.[0]) { videoUrl = '/uploads/videos/' + req.files.video[0].filename; videoSrc = 'upload'; }
        else return res.status(400).json({ error: 'Video file or link required!' });
        const pAccessLevel = partAccessLevel || accessLevel || 'free';
        if (data.type === 'movie') data.parts = [{ partNumber: '1', title: 'Full Movie', videoUrl, videoSource: videoSrc, accessLevel: pAccessLevel }];
        else data.seasons = [{ seasonNumber: parseInt(seasonNumber) || 1, title: 'Season ' + (seasonNumber || 1), episodes: [{ episodeNumber: parseInt(episodeNumber) || 1, title: episodeTitle || 'Episode 1', videoUrl, videoSource: videoSrc, accessLevel: pAccessLevel }] }];
        await Content.updateMany({}, { isLatest: false });
        const content = await Content.create(data);
        res.json({ success: true, content, message: 'Uploaded!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/contents/:id', authMiddleware, subAdminOrAbove, upload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'trailer', maxCount: 1 }]), async (req, res) => {
    try {
        const updateData = { ...req.body, updatedAt: new Date() };
        if (req.files?.thumbnail?.[0]) updateData.thumbnailUrl = await uploadToCloudinary(req.files.thumbnail[0], 'thumbnails');
        if (req.files?.trailer?.[0]) updateData.trailerUrl = await uploadToCloudinary(req.files.trailer[0], 'trailers', 'video');
        const c = await Content.findByIdAndUpdate(req.params.id, updateData, { new: true });
        if (!c) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, content: c });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/contents/:id', authMiddleware, subAdminOrAbove, async (req, res) => { await Content.findByIdAndDelete(req.params.id); res.json({ success: true }); });

app.post('/api/admin/movies/:id/part', authMiddleware, adminMiddleware, upload.single('video'), async (req, res) => {
    try {
        const c = await Content.findById(req.params.id);
        if (!c || c.type !== 'movie') return res.status(400).json({ error: 'Movie not found' });
        const { partNumber, partTitle, videoSource, externalLink, accessLevel } = req.body;
        let videoUrl = '';
        if ((videoSource === 'external' || videoSource === 'pixeldrain') && externalLink && externalLink.trim()) videoUrl = externalLink.trim();
        else if (req.file) videoUrl = '/uploads/videos/' + req.file.filename;
        else return res.status(400).json({ error: 'Video file or link required!' });
        c.parts.push({ partNumber: partNumber || String(c.parts.length + 1), title: partTitle || 'Part ' + (c.parts.length + 1), videoUrl, videoSource: videoSource || 'external', accessLevel: accessLevel || 'free' });
        c.updatedAt = new Date(); await c.save();
        res.json({ success: true, content: c, message: 'Part added!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/series/:id/episode', authMiddleware, adminMiddleware, upload.single('video'), async (req, res) => {
    try {
        const c = await Content.findById(req.params.id);
        if (!c || c.type !== 'series') return res.status(400).json({ error: 'Series not found' });
        const { seasonNumber, episodeNumber, episodeTitle, videoSource, externalLink, accessLevel } = req.body;
        let videoUrl = '';
        if ((videoSource === 'external' || videoSource === 'pixeldrain') && externalLink && externalLink.trim()) videoUrl = externalLink.trim();
        else if (req.file) videoUrl = '/uploads/videos/' + req.file.filename;
        else return res.status(400).json({ error: 'Video file or link required!' });
        let season = c.seasons.find(s => s.seasonNumber === parseInt(seasonNumber));
        if (!season) { season = { seasonNumber: parseInt(seasonNumber), title: 'Season ' + seasonNumber, episodes: [] }; c.seasons.push(season); }
        season.episodes.push({ episodeNumber: parseInt(episodeNumber) || season.episodes.length + 1, title: episodeTitle || 'Episode ' + (season.episodes.length + 1), videoUrl, videoSource: videoSource || 'external', accessLevel: accessLevel || 'free' });
        c.updatedAt = new Date(); await c.save();
        res.json({ success: true, content: c, message: 'Episode added!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== SUBSCRIPTIONS (HEAD ADMIN ONLY) ==========
app.get('/api/admin/subscriptions', authMiddleware, headAdminMiddleware, async (req, res) => {
    const { status } = req.query; let query = {}; if (status) query.status = status;
    const transactions = await Transaction.find(query).sort({ createdAt: -1 });
    const pendingCount = await Transaction.countDocuments({ status: 'pending' });
    const archivedCount = await Transaction.countDocuments({ status: 'archived' });
    const approvedCount = await Transaction.countDocuments({ status: 'approved' });
    res.json({ transactions, pendingCount, archivedCount, approvedCount, totalRevenue: (await Transaction.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]))[0]?.total || 0 });
});

app.put('/api/admin/subscriptions/:id', authMiddleware, headAdminMiddleware, async (req, res) => {
    const { status, adminNote } = req.body;
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ error: 'Not found' });
    txn.status = status; txn.adminNote = adminNote || ''; txn.processedBy = req.user.email; txn.processedAt = new Date(); await txn.save();
    const user = await User.findById(txn.userId);
    if (status === 'approved') {
        const days = { weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };
        const exp = new Date(); exp.setDate(exp.getDate() + (days[txn.duration] || 30));
        await User.findByIdAndUpdate(txn.userId, { subscription: { plan: txn.plan, duration: txn.duration, expiresAt: exp, startDate: new Date(), status: 'active', maxDevices: 6, approvedBy: req.user.email, approvedAt: new Date() }, isFlagged: false, devices: [], deviceCount: 0 });
        if (user) { user.notifications.push({ message: 'Your ' + txn.plan.toUpperCase() + ' subscription has been APPROVED!', type: 'success' }); await user.save(); }
        res.json({ success: true, message: 'Approved!' });
    } else if (status === 'rejected') {
        await User.findByIdAndUpdate(txn.userId, { 'subscription.status': 'none', 'subscription.plan': 'free', 'subscription.duration': 'none' });
        if (user) { user.notifications.push({ message: 'Your subscription was rejected. Reason: ' + (adminNote || 'No reason provided'), type: 'warning' }); await user.save(); }
        res.json({ success: true, message: 'Rejected.' });
    } else if (status === 'archived') {
        if (user) { user.notifications.push({ message: 'Your subscription has been archived.', type: 'system' }); await user.save(); }
        res.json({ success: true, message: 'Archived.' });
    } else { res.json({ success: true, message: 'Updated.' }); }
});

// ========== USER MANAGEMENT (HEAD ADMIN ONLY) ==========
app.get('/api/admin/users', authMiddleware, headAdminMiddleware, async (req, res) => { res.json(await User.find({ role: { $ne: 'admin' } }).select('-password').sort({ createdAt: -1 })); });
app.put('/api/admin/users/:id', authMiddleware, headAdminMiddleware, async (req, res) => {
    const { fullName, phone, isFlagged, flagReason, subscription } = req.body;
    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (phone) updateData.phone = phone;
    if (isFlagged !== undefined) updateData.isFlagged = isFlagged;
    if (flagReason) updateData.flagReason = flagReason;
    if (subscription) updateData.subscription = subscription;
    await User.findByIdAndUpdate(req.params.id, updateData);
    res.json({ success: true });
});
app.delete('/api/admin/users/:id', authMiddleware, headAdminMiddleware, async (req, res) => { await User.findByIdAndDelete(req.params.id); res.json({ success: true }); });

// ========== FLAGGED USERS ==========
app.get('/api/admin/flagged-users', authMiddleware, adminMiddleware, async (req, res) => { res.json(await User.find({ isFlagged: true }).select('-password')); });
app.put('/api/admin/flagged-users/:id', authMiddleware, headAdminMiddleware, async (req, res) => { const user = await User.findById(req.params.id); if (!user) return res.status(404).json({ error: 'Not found' }); if (req.body.action === 'clear') { user.isFlagged = false; user.devices = []; user.deviceCount = 0; } else if (req.body.action === 'terminate') { user.subscription = { plan: 'free', duration: 'none', status: 'expired', maxDevices: 6 }; } await user.save(); res.json({ success: true }); });

// ========== COMMENTS MANAGEMENT ==========
app.get('/api/admin/comments', authMiddleware, adminMiddleware, async (req, res) => { const contents = await Content.find({ 'comments.0': { $exists: true } }).select('title comments'); let all = []; contents.forEach(c => c.comments.forEach(cm => all.push({ _id: cm._id, contentId: c._id, contentTitle: c.title, userName: cm.userName, text: cm.text, likes: cm.likes || 0, createdAt: cm.createdAt }))); res.json(all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); });
app.delete('/api/admin/comments/:contentId/:commentId', authMiddleware, headAdminMiddleware, async (req, res) => { const c = await Content.findById(req.params.contentId); if (!c) return res.status(404).json({ error: 'Not found' }); c.comments = c.comments.filter(cm => cm._id.toString() !== req.params.commentId); await c.save(); res.json({ success: true }); });

// ========== ADS ==========
app.get('/api/ads', async (req, res) => { res.json(await Ad.find({ isActive: true }).sort({ createdAt: -1 })); });
app.get('/api/admin/ads', authMiddleware, adminMiddleware, async (req, res) => { res.json(await Ad.find().sort({ createdAt: -1 })); });
app.post('/api/admin/ads', authMiddleware, subAdminOrAbove, upload.single('adMedia'), async (req, res) => {
    const { type, title, description, link, position, contactPhone, contactName, businessName, targetPlans } = req.body;
    let mediaUrl = req.file ? await uploadToCloudinary(req.file, 'ads', 'auto') : req.body.mediaUrl || '';
    const ad = await Ad.create({ type, title, description: description || '', mediaUrl, link: link || '', position: position || 'sidebar', contactPhone: contactPhone || '', contactName: contactName || '', businessName: businessName || '', targetPlans: targetPlans ? targetPlans.split(',').map(p => p.trim()) : ['free'], createdBy: req.user.email });
    res.json({ success: true, ad });
});
app.put('/api/admin/ads/:id', authMiddleware, subAdminOrAbove, async (req, res) => { await Ad.findByIdAndUpdate(req.params.id, { ...req.body, updatedAt: new Date() }); res.json({ success: true }); });
app.delete('/api/admin/ads/:id', authMiddleware, subAdminOrAbove, async (req, res) => { await Ad.findByIdAndDelete(req.params.id); res.json({ success: true }); });

// ========== PAYMENTS (HEAD ADMIN ONLY) ==========
app.get('/api/admin/payments', authMiddleware, headAdminMiddleware, async (req, res) => { const transactions = await Transaction.find({ status: 'approved' }).sort({ createdAt: -1 }); const totalRevenue = transactions.reduce((s, t) => s + (t.amount || 0), 0); const withdrawals = await Withdrawal.find(); const totalWithdrawn = withdrawals.filter(w => w.status === 'completed').reduce((s, w) => s + (w.amount || 0), 0); const subscribers = await User.find({ role: 'user', 'subscription.status': 'active', 'subscription.expiresAt': { $gt: new Date() } }); res.json({ transactions, totalRevenue, totalWithdrawn, availableBalance: totalRevenue - totalWithdrawn, activeSubscribers: subscribers.length, subscribers }); });
app.post('/api/admin/withdraw', authMiddleware, headAdminMiddleware, async (req, res) => { const { amount, bankName, accountNumber, accountName } = req.body; const w = await Withdrawal.create({ amount, bankDetails: { bankName, accountNumber, accountName }, requestedBy: req.user._id, requestedByEmail: req.user.email, requestedByName: req.user.fullName }); res.json({ success: true, withdrawal: w }); });
app.get('/api/admin/withdrawals', authMiddleware, headAdminMiddleware, async (req, res) => { res.json(await Withdrawal.find().sort({ createdAt: -1 })); });
app.put('/api/admin/withdrawals/:id', authMiddleware, headAdminMiddleware, async (req, res) => { await Withdrawal.findByIdAndUpdate(req.params.id, { status: req.body.status, completedAt: new Date(), processedBy: req.user.fullName }); res.json({ success: true }); });
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => { const totalContent = await Content.countDocuments(); const totalUsers = await User.countDocuments({ role: 'user' }); const activeSubscribers = await User.countDocuments({ role: 'user', 'subscription.status': 'active', 'subscription.expiresAt': { $gt: new Date() } }); const pendingPayments = await Transaction.countDocuments({ status: 'pending' }); const flaggedUsers = await User.countDocuments({ isFlagged: true }); const views = await Content.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }]); const downloads = await Content.aggregate([{ $group: { _id: null, total: { $sum: '$downloads' } } }]); const revenue = await Transaction.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]); res.json({ totalContent, totalMovies: await Content.countDocuments({ type: 'movie' }), totalSeries: await Content.countDocuments({ type: 'series' }), totalUsers, activeSubscribers, pendingPayments, flaggedUsers, totalViews: views[0]?.total || 0, totalDownloads: downloads[0]?.total || 0, totalComments: (await Content.aggregate([{ $unwind: '$comments' }, { $group: { _id: null, total: { $sum: 1 } } }]))[0]?.total || 0, activeAds: await Ad.countDocuments({ isActive: true }), totalRevenue: revenue[0]?.total || 0 }); });

app.post('/api/mylist/:contentId', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id); if (!user.myList.includes(req.params.contentId)) { user.myList.push(req.params.contentId); await user.save(); } res.json({ success: true }); });
app.delete('/api/mylist/:contentId', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id); user.myList = user.myList.filter(id => id.toString() !== req.params.contentId); await user.save(); res.json({ success: true }); });
app.get('/api/mylist', authMiddleware, async (req, res) => { const user = await User.findById(req.user.id).populate('myList'); res.json(user.myList || []); });
// Stream proxy for direct MP4 links (Pixeldrain etc.)
app.get('/api/stream', async (req, res) => {
    try {
        const videoUrl = req.query.url;
        if (!videoUrl) return res.status(400).send('Missing url');
        // Only allow Pixeldrain direct links (basic safety)
        if (!videoUrl.startsWith('https://pixeldrain.com/api/files/') && !videoUrl.startsWith('https://pd.whale.nahted.com/')) {
            return res.status(403).send('Unsupported source');
        }
        const https = require('https');
        const parsed = new URL(videoUrl);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'User-Agent': 'niroMovie/1.0'
            }
        };
        const externalReq = https.request(options, (externalRes) => {
            // Forward headers that matter
            res.writeHead(externalRes.statusCode, {
                'Content-Type': externalRes.headers['content-type'] || 'video/mp4',
                'Content-Length': externalRes.headers['content-length'],
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*'
            });
            externalRes.pipe(res);
        });
        externalReq.on('error', (e) => {
            res.status(500).send('Stream error');
        });
        externalReq.end();
    } catch (e) {
        res.status(500).send('Stream error');
    }
});
// Health check for UptimeRobot
app.get('/health', (req, res) => { res.status(200).send('OK'); });

// YouTube latest video
app.get('/api/youtube/latest', async (req, res) => {
    try {
        const https = require('https');
        const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCpmwvRW9f8QIFEgfY_ueNCA';
        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                const match = data.match(/<entry>([\s\S]*?)<\/entry>/);
                if (!match) return res.json({ error: 'No video found' });
                const entry = match[1];
                const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
                const link = (entry.match(/<link rel=['"]alternate['"] href=['"]([^'"]+)['"]/) || [])[1] || '';
                const videoId = link.split('v=')[1];
                const thumbnail = videoId ? 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg' : '';
                res.json({ title, link, thumbnail, videoId });
            });
        }).on('error', () => res.json({ error: 'Failed to fetch' }));
    } catch (e) { res.json({ error: e.message }); }
});

// ========== START ==========
createAdmins().then(() => {
    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, '0.0.0.0', () => { console.log('\nNIROMOVIE API\nPort: ' + PORT + '\nVersion: v1 (Render)\n'); });
    process.on('SIGTERM', () => { server.close(() => { process.exit(0); }); });
    process.on('SIGINT', () => { server.close(() => { process.exit(0); }); });
});
