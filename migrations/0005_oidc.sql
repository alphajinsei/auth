CREATE TABLE `authorization_codes` (
	`code_hash` varchar(64) NOT NULL,
	`client_id` varchar(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`redirect_uri` varchar(512) NOT NULL,
	`scope` varchar(255) NOT NULL,
	`code_challenge` varchar(64) NOT NULL,
	`nonce` varchar(255),
	`amr` varchar(64) NOT NULL,
	`auth_time` datetime NOT NULL,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `authorization_codes_code_hash` PRIMARY KEY(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` varchar(64) NOT NULL,
	`secret_hash` varchar(64) NOT NULL,
	`name` varchar(64) NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oauth_clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_consents` (
	`user_id` varchar(36) NOT NULL,
	`client_id` varchar(64) NOT NULL,
	`scope` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oauth_consents_user_id_client_id_pk` PRIMARY KEY(`user_id`,`client_id`)
);
--> statement-breakpoint
ALTER TABLE `authorization_codes` ADD CONSTRAINT `authorization_codes_client_id_oauth_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `authorization_codes` ADD CONSTRAINT `authorization_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_consents` ADD CONSTRAINT `oauth_consents_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_consents` ADD CONSTRAINT `oauth_consents_client_id_oauth_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON DELETE cascade ON UPDATE no action;