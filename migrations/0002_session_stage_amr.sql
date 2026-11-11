ALTER TABLE `sessions` ADD `stage` varchar(16) DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `amr` varchar(64) DEFAULT 'pwd' NOT NULL;