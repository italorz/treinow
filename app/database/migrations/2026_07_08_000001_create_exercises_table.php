<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('exercises', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            $table->string('name');
            $table->string('name_raw');
            $table->string('muscle_group')->nullable()->index();
            $table->json('secondary_muscles')->nullable();
            $table->string('equipment')->index();
            $table->string('movement_pattern')->nullable()->index();
            $table->boolean('is_unilateral')->default(false);
            $table->boolean('is_stretch')->default(false);
            $table->string('video_path');
            $table->string('video_loop_path')->nullable();
            $table->string('classified_by')->default('rule');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exercises');
    }
};
