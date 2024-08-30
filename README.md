# CloudS

CloudS is a file management application that allows users to upload, manage, and share files. The application is built with Node.js, Express, Prisma, and uses Cloudinary for file storage.

## Features

- User authentication with login and signup.
- File upload with Cloudinary integration.
- Manage files and folders.
- Download, delete, and share files.
- Responsive and modern UI with Bootstrap.

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: PostgreSQL
- **ORM**: Prisma
- **File Storage**: Cloudinary
- **Frontend**: EJS, Bootstrap
- **Authentication**: Custom implementation
- **Styling**: CSS, Font Awesome

## Project Structure

### 1. File Details Page (`file-details.ejs`)

This page provides detailed information about a file, including:

- File name
- File size
- Upload date
- File type
- Preview (for image files)

It also includes options to download, delete, or share the file, with modals for confirmation and sharing link.

### 2. Index Page (`index.ejs`)

The landing page for the application, featuring:

- User login and signup forms
- Error and success messages
- Responsive design with tabs for login and signup

### 3. Prisma Schema (`schema.prisma`)

Defines the database schema with models for `User`, `Folder`, `File`, and `Session`. It also specifies the PostgreSQL database provider and Prisma client generator.

### Models

- **User**: Represents an application user with a unique username and password.
- **Folder**: Represents a folder that contains files and is associated with a user.
- **File**: Represents a file with attributes like name, path, size, URL, and upload time. Files are associated with folders and may have an original folder.
- **Session**: Represents user sessions with a unique session ID and expiration date.

## Setup

1. **Clone the Repository**
   ```bash
   git clone <repository-url>

2. **Install Dependencies**

    ```bash
    cd <project-directory>
    npm install

3. **Configure Environment Variables**

Create a .env file in the root directory and add the following environment variables:

    DATABASE_URL=your-postgresql-database-url
    CLOUDINARY_URL=your-cloudinary-url

4. **Run Migrations**

    ```bash
    npx prisma migrate dev

5. **Start the Application**

    ```bash
    npm start

## Usage
- **Login**: Access the login form on the homepage and authenticate with your credentials.
- **Signup**: Create a new account using the signup form.
- **Upload Files**: Use the file upload functionality integrated with Cloudinary.
- **Manage Files**: View, download, delete, and share files from the file details page.