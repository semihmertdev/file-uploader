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
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


const sessionStore = new pgSession({
  pool: pool,
  tableName: 'Session',
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'yourSecretKeyHere',  
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }  
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
      // Optionally, add a delay before retrying
      await new Promise(res => setTimeout(res, 2000));
    }
  }
};

passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user) {
        return done(null, false, { message: 'Geçersiz kimlik bilgileri' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (isMatch) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Geçersiz kimlik bilgileri' });
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
  failureFlash: true
}));

app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      req.flash('error', 'Kullanıcı adı zaten alınmış. Lütfen başka bir kullanıcı adı seçin.');
      return res.redirect('/');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await prisma.user.create({
      data: { username, password: hashedPassword }
    });

    await Promise.all([
      prisma.folder.upsert({
        where: {
          name_userId: {
            name: 'All Files',
            userId: newUser.id
          }
        },
        update: {},
        create: {
          name: 'All Files',
          userId: newUser.id
        }
      }),
      prisma.folder.upsert({
        where: {
          name_userId: {
            name: 'Trash',
            userId: newUser.id
          }
        },
        update: {},
        create: {
          name: 'Trash',
          userId: newUser.id
        }
      })
    ]);

    req.flash('success', 'Kayıt başarılı. Artık giriş yapabilirsiniz.');
    res.redirect('/');
  } catch (error) {
    console.error('Kullanıcı kaydedilirken hata oluştu:', error);
    req.flash('error', 'Kayıt başarısız oldu. Lütfen tekrar deneyin.');
    res.redirect('/');
  }
});

app.get('/dashboard', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  try {
    const userId = req.user.id;

    let folders = await prisma.folder.findMany({
      where: { 
        userId: userId,
        name: { not: 'Trash' }
      },
    });

    let trashFolder = await prisma.folder.findFirst({
      where: { 
        userId: userId,
        name: 'Trash'
      },
    });

    if (!trashFolder) {
      trashFolder = await prisma.folder.create({
        data: {
          name: 'Trash',
          userId: userId,
        },
      });
    }

    let allFilesFolder = await prisma.folder.findFirst({
      where: {
        userId: userId,
        name: 'All Files',
      },
    });

    if (!allFilesFolder) {
      allFilesFolder = await prisma.folder.create({
        data: {
          name: 'All Files',
          userId: userId,
        },
      });
    }

    let selectedFolder = null;
    if (req.query.folderId) {
      const folderId = parseInt(req.query.folderId, 10);
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

    console.log('File found:', file); // Debugging log

    if (!file) {
      return res.status(404).send('File not found in database');
    }

    if (!file.url) {
      return res.status(404).send('File URL not found');
    }

    console.log('Redirecting to:', file.url); // Debugging log

    // Redirect to the Cloudinary URL
    res.redirect(file.url);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).send('Server Error');
  }
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.session.destroy((err) => {
      if (err) {
        console.log('Error destroying session:', err);
      }
      res.redirect('/'); // Redirect to the homepage or login page
    });
  });
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
      return res.status(400).send('Cannot delete this folder');
    }

    await prisma.file.deleteMany({
      where: { folderId },
    });

    await prisma.folder.delete({
      where: { id: folderId },
    });

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error deleting folder:', error);
    res.status(500).send('Server Error');
  }
});

app.post('/folders/:id/rename', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const folderId = parseInt(req.params.id, 10);
  const { newName } = req.body;

  if (isNaN(folderId) || !newName) {
    return res.status(400).send('Invalid request');
  }

  try {
    const folder = await prisma.folder.findUnique({
      where: { id: folderId },
    });

    if (!folder || folder.name === 'All Files' || folder.name === 'Trash') {
      return res.status(400).send('Cannot rename this folder');
    }

    await prisma.folder.update({
      where: { id: folderId },
      data: { name: newName },
    });

    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error renaming folder:', error);
    res.status(500).send('Server Error');
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const file = req.file;
  const folderId = parseInt(req.body.folderId, 10);

  if (!file) {
    return res.status(400).send('No file uploaded');
  }

  if (isNaN(folderId)) {
    return res.status(400).send('Invalid folderId');
  }

  try {
    const folderExists = await prisma.folder.findFirst({
      where: {
        id: folderId,
        userId: req.user.id,
      },
    });

    if (!folderExists) {
      return res.status(400).send('Folder not found or access denied');
    }

    // Upload file to Cloudinary with retry logic
    const result = await uploadToCloudinary(file.path);

    // Create the file in the selected folder with Cloudinary URL
    const fileData = await prisma.file.create({
      data: {
        name: file.originalname,
        path: result.secure_url, // Store Cloudinary URL instead of local path
        size: file.size,
        url: result.secure_url, // Store Cloudinary URL
        folderId: folderId,
      },
    });

    // Create the file in the "All Files" folder
    const allFilesFolder = await prisma.folder.findFirst({
      where: {
        userId: req.user.id,
        name: 'All Files',
      },
    });

    if (allFilesFolder) {
      await prisma.file.create({
        data: {
          name: file.originalname,
          path: result.secure_url, // Store Cloudinary URL instead of local path
          size: file.size,
          url: result.secure_url, // Store Cloudinary URL
          folderId: allFilesFolder.id,
        },
      });
    } else {
      // Optionally, handle the case where the "All Files" folder doesn't exist
    }

    fs.unlinkSync(file.path); // Clean up local file

    req.flash('success', 'File uploaded successfully');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error uploading file:', error);
    req.flash('error', 'File upload failed');
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
      return res.status(404).send('File not found');
    }

    if (file.url) {
      const publicId = file.url.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId);
    } else {
      console.warn(`File with id ${fileId} has no URL. Skipping Cloudinary deletion.`);
    }

    await prisma.file.delete({
      where: { id: fileId },
    });

    req.flash('success', 'File deleted successfully');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error deleting file:', error);
    req.flash('error', 'Failed to delete file');
    res.redirect('/dashboard');
  }
});

// New route for moving a file to trash
app.post('/files/:id/moveToTrash', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const fileId = parseInt(req.params.id, 10);
  const userId = req.user.id;

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
      include: { folder: true },
    });

    if (!file) {
      return res.status(404).send('File not found');
    }

    const trashFolder = await prisma.folder.findFirst({
      where: {
        userId: userId,
        name: 'Trash',
      },
    });

    if (!trashFolder) {
      return res.status(400).send('Trash folder not found');
    }

    // Update file to move it to Trash and save original folder ID
    await prisma.file.update({
      where: { id: fileId },
      data: {
        folderId: trashFolder.id,
        originalFolderId: file.folderId,  // Save the original folder ID
      },
    });

    req.flash('success', 'File moved to Trash.');
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Error moving file to Trash:', error);
    req.flash('error', 'Failed to move file to Trash.');
    res.redirect('/dashboard');
  }
});

app.post('/files/:id/restore', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/');

  const fileId = parseInt(req.params.id, 10);

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      return res.status(404).send('File not found');
    }

    if (!file.originalFolderId) {
      return res.status(400).send('Original folder not found');
    }

    // Restore file to its original folder
    await prisma.file.update({
      where: { id: fileId },
      data: {
        folderId: file.originalFolderId,
        originalFolderId: null,  // Clear the original folder ID after restoring
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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});