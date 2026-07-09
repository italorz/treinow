<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('workout_day_exercise', function (Blueprint $table) {
            $table->foreignId('reserve_exercise_id')
                ->nullable()
                ->after('exercise_id')
                ->constrained('exercises')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('workout_day_exercise', function (Blueprint $table) {
            $table->dropConstrainedForeignId('reserve_exercise_id');
        });
    }
};
