require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const pg = require('pg');
const pgSession = require('connect-pg-simple')(session);
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');
const flash = require('connect-flash');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const app = express();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const sessionStore = new pgSession({
  pool: pool,
  tableName: 'Session',
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: sessionStore,
  secret: process.env.SECRET_KEY,
  resave: false,
  saveUninitialized: false,
}));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const upload = multer({ dest: 'uploads/' });

const uploadToCloudinary = async (filePath) => {
  let retryAttempts = 3;
  while (retryAttempts > 0) {
    try {
      const result = await cloudinary.uploader.upload(filePath);
      return result;
    } catch (error) {
      console.error('Cloudinary upload error:', error);
      retryAttempts -= 1;
      if (retryAttempts === 0) {
        throw new Error('Failed to upload file after multiple attempts');
      }
      await new Promise(res => setTimeout(res, 2000));
    }
  }
};

passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        return done(null, false, { message: 'Invalid credentials' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (isMatch) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Invalid credentials' });
      }
    } catch (error) {
      return done(error);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (error) {
    done(error);
  }
});

app.get('/', (req, res) => {
  res.render('index', { messages: req.flash() });
});

app.get('/files/:id/details', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).send('Invalid file ID');
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return res.status(404).send('File not found');
    }

    res.render('file-details', { file });
  } catch (error) {
    console.error('Error fetching file details:', error);
    res.status(500).send('Server Error');
  }
});

app.post('/login', passport.authenticate('local', { 
  successRedirect: '/dashboard', 
  failureRedirect: '/',
  failureFlash: true,
}));

app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      req.flash('error', 'Username is already taken. Please choose another username.');
      return res.redirect('/');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await prisma.user.create({
      data: { username, password: hashedPassword },
    });

    await Promise.all([
      prisma.folder.create({
        data: {
          name: 'All Files',
          userId: newUser.id,
        },
      }),
      prisma.folder.create({
        data: {
          name: 'Trash',
          userId: newUser.id,
        },
      }),
    ]);

    req.flash('success', 'Registration successful. You can now log in.');
    res.redirect('/');
  } catch (error) {
    console.error('Error registering user:', error);
    req.flash('error', 'Registration failed. Please try again.');
    res.redirect('/');
  }
});

app.get('/dashboard', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  try {
    const userId = req.user.id;

    const folders = await prisma.folder.findMany({
      where: { 
        userId: userId,
        name: { not: 'Trash' },
      },
    });

    const trashFolder = await prisma.folder.findFirst({
      where: { 
        userId: userId,
        name: 'Trash',
      },
    });

    const allFilesFolder = await prisma.folder.findFirst({
      where: {
        userId: userId,
        name: 'All Files',
      },
    });

    let selectedFolder = null;
    let folderId = null;
    if (req.query.folderId) {
      folderId = parseInt(req.query.folderId, 10);
      if (!isNaN(folderId)) {
        selectedFolder = await prisma.folder.findUnique({
          where: { id: folderId },
          include: { files: true },
        });
      }
    }

    res.render('dashboard', {
      folders,
      selectedFolder: selectedFolder || {},
      allFilesFolder,
      trashFolder,
      folderId,
      messages: req.flash() // Add this line
    });
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).send('Server Error');
  }
});

app.get('/files/:id/download', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).send('Invalid file ID');
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return res.status(404).send('File not found in database');
    }

    if (!file.url) {
      return res.status(404).send('File URL not found');
    }

    res.redirect(file.url);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).send('Server Error');
  }
});

app.post('/folders', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');
  
  const { name } = req.body;
  const userId = req.user.id;

  try {
    await prisma.folder.create({
      data: {
        name,
        userId,
      },
    });
    req.flash('success', 'Folder created successfully.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error creating folder:', error);
    req.flash('error', 'Failed to create folder.');
    res.redirect('/dashboard');
  }
});

app.post('/folders/:id/delete', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const folderId = parseInt(req.params.id, 10);

  if (isNaN(folderId)) {
    return res.status(400).send('Invalid folderId');
  }

  try {
    const folder = await prisma.folder.findUnique({
      where: { id: folderId },
    });

    if (!folder || folder.name === 'All Files' || folder.name === 'Trash') {
      req.flash('error', 'Cannot delete this folder.');
      return res.redirect('/dashboard');
    }

    const trashFolder = await prisma.folder.findFirst({
      where: { 
        userId: req.user.id,
        name: 'Trash',
      },
    });

    if (!trashFolder) {
      req.flash('error', 'Trash folder not found.');
      return res.redirect('/dashboard');
    }

    await prisma.file.updateMany({
      where: { folderId: folderId },
      data: { folderId: trashFolder.id },
    });

    await prisma.folder.delete({
      where: { id: folderId },
    });

    req.flash('success', 'Folder deleted successfully.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error deleting folder:', error);
    req.flash('error', 'Failed to delete folder.');
    res.redirect('/dashboard');
  }
});


app.post('/files/:id/delete', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).send('Invalid fileId');
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      req.flash('error', 'File not found.');
      return res.redirect('/dashboard');
    }

    const trashFolder = await prisma.folder.findFirst({
      where: { 
        userId: req.user.id,
        name: 'Trash',
      },
    });

    if (!trashFolder) {
      req.flash('error', 'Trash folder not found.');
      return res.redirect('/dashboard');
    }

    // Dosyayı çöp kutusuna taşıyın
    await prisma.file.update({
      where: { id: fileId },
      data: {
        folderId: trashFolder.id,
        originalFolderId: file.folderId
      },
    });

    req.flash('success', 'File moved to trash.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error moving file to trash:', error);
    req.flash('error', 'Failed to move file to trash.');
    res.redirect('/dashboard');
  }
});


app.post('/files/:id/restore', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).send('Invalid file ID');
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      select: { originalFolderId: true },  // Sadece orijinal klasör ID'sini seçin
    });

    if (!file) {
      return res.status(404).send('File not found');
    }

    if (!file.originalFolderId) {
      return res.status(400).send('Original folder not found');
    }

    // Dosyayı orijinal klasörüne geri yükleyin
    await prisma.file.update({
      where: { id: fileId },
      data: {
        folderId: file.originalFolderId,
        originalFolderId: null,  // Orijinal klasör ID'sini temizleyin
      },
    });

    req.flash('success', 'File restored successfully.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error restoring file:', error);
    req.flash('error', 'Failed to restore file.');
    res.redirect('/dashboard');
  }
});





app.post('/files/:id/permanent-delete', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const fileId = parseInt(req.params.id, 10);

  if (isNaN(fileId)) {
    return res.status(400).send('Invalid fileId');
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      req.flash('error', 'File not found.');
      return res.redirect('/dashboard');
    }

    const trashFolder = await prisma.folder.findFirst({
      where: { 
        userId: req.user.id,
        name: 'Trash',
      },
    });

    if (file.folderId !== trashFolder.id) {
      req.flash('error', 'Only files in the Trash can be permanently deleted.');
      return res.redirect('/dashboard');
    }

    // Delete file from Cloudinary
    const publicId = file.url.split('/').pop().split('.')[0];
    await cloudinary.uploader.destroy(publicId);

    await prisma.file.delete({
      where: { id: fileId },
    });

    req.flash('success', 'File permanently deleted.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error permanently deleting file:', error);
    req.flash('error', 'Failed to permanently delete file.');
    res.redirect('/dashboard');
  }
});

app.post('/folders/:id/rename', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const { id } = req.params;
  const { newFolderName } = req.body;

  try {
    const folder = await prisma.folder.findUnique({
      where: { id: Number(id) },
    });

    if (!folder || folder.name === 'All Files' || folder.name === 'Trash') {
      req.flash('error', 'Cannot rename this folder.');
      return res.redirect('/dashboard');
    }

    await prisma.folder.update({
      where: { id: Number(id) },
      data: { name: newFolderName }
    });
    req.flash('success', 'Folder renamed successfully.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error renaming folder:', error);
    req.flash('error', 'Failed to rename folder.');
    res.redirect('/dashboard');
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const file = req.file;
  const folderId = parseInt(req.body.folderId, 10);

  if (!file || isNaN(folderId)) {
    return res.status(400).send('Invalid request');
  }

  try {
    const uploadResult = await uploadToCloudinary(file.path);

    const newFile = await prisma.file.create({
      data: {
        name: file.originalname,
        path: file.path, // Consider using uploadResult.public_id if you want to store the Cloudinary path
        size: file.size,
        url: uploadResult.secure_url,
        folderId: folderId,
        // uploadTime is set to @default(now()) in the schema, so we don't need to specify it here
        // originalFolderId is optional, so we don't need to specify it for a new upload
      },
    });

    req.flash('success', 'File uploaded successfully.');
    res.redirect(`/dashboard?folderId=${folderId}`);
  } catch (error) {
    console.error('Error uploading file:', error);
    req.flash('error', 'Failed to upload file.');
    res.redirect('/dashboard');
  } finally {
    fs.unlinkSync(file.path);
  }
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Error logging out:', err);
      return res.redirect('/dashboard');
    }
    res.redirect('/');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});