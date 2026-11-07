CREATE TABLE `memos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`text` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp,
	`tag` varchar(64),
	CONSTRAINT `memos_id` PRIMARY KEY(`id`)
);
