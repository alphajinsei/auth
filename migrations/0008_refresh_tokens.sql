CREATE TABLE `refresh_tokens` (
	`token_hash` varchar(64) NOT NULL,
	`family_id` varchar(22) NOT NULL,
	`client_id` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`scope` varchar(255) NOT NULL,
	`expires_at` datetime NOT NULL,
	`family_expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `refresh_tokens_token_hash` PRIMARY KEY(`token_hash`)
);
--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_client_id_oauth_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`family_id`);