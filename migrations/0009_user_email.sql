ALTER TABLE `users` ADD `email` varchar(254);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_email_unique` UNIQUE(`email`);