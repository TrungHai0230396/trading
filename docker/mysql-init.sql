-- Granted at container init so Prisma Migrate can create the shadow DB.
GRANT ALL PRIVILEGES ON *.* TO 'tranding'@'%';
FLUSH PRIVILEGES;
