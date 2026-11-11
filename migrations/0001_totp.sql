CREATE TABLE `totp_credentials` (
	`user_id` varchar(36) NOT NULL,
	`secret` varchar(255) NOT NULL,
	`confirmed_at` datetime,
	`last_step` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `totp_credentials_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `totp_credentials` ADD CONSTRAINT `totp_credentials_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;