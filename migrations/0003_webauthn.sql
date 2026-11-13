CREATE TABLE `webauthn_challenges` (
	`id_hash` varchar(64) NOT NULL,
	`challenge` varchar(64) NOT NULL,
	`purpose` varchar(16) NOT NULL,
	`user_id` varchar(36),
	`expires_at` datetime NOT NULL,
	CONSTRAINT `webauthn_challenges_id_hash` PRIMARY KEY(`id_hash`)
);
--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`id` varchar(512) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`public_key` text NOT NULL,
	`sign_count` bigint unsigned NOT NULL DEFAULT 0,
	`transports` varchar(255),
	`name` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`last_used_at` datetime,
	CONSTRAINT `webauthn_credentials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `webauthn_challenges` ADD CONSTRAINT `webauthn_challenges_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `webauthn_credentials` ADD CONSTRAINT `webauthn_credentials_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;