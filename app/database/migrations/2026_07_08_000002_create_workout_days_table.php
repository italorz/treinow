<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workout_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('weekday'); // 0 = domingo ... 6 = sábado
            $table->string('title')->nullable();
            $table->json('focus_muscles')->nullable();
            $table->unsignedSmallInteger('duration_min')->nullable();
            $table->boolean('is_rest')->default(false);
            $table->string('source')->default('manual'); // manual | gemini
            $table->timestamps();

            $table->unique(['user_id', 'weekday']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('workout_days');
    }
};
